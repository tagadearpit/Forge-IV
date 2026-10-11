import { User } from '../models/User.js';
import { Event } from '../models/Event.js';
import { Topic } from '../models/Topic.js';
import { getMasteryOverview, type TopicMasteryView } from './learnerModel.js';
import { getAIProvider } from '../ai/provider.js';
import { retrieveUnits } from './rag.js';
import { inZPD } from '../utils/bkt.js';

/**
 * Study plan generation: weak topics + forgetting curve + days-to-exam.
 * Scheduling rule (documented so the choice is defensible, not arbitrary):
 *   score = weakness·0.5 + decay·0.3 + ignorance·0.2 + urgency·0.4
 * Urgency only kicks in once an exam date exists, and rises as it approaches.
 */

export interface StudyTask {
  id: string;
  topicId: string | null;
  topicName: string;
  date: string;
  kind: 'learn' | 'review' | 'quiz';
  title: string;
  rationale: string;
  estimatedMin: number;
  done: boolean;
}

export async function generateStudyPlan(userId: string): Promise<StudyTask[]> {
  const [overview, user] = await Promise.all([getMasteryOverview(userId), User.findById(userId).lean()]);
  if (!overview.length) return [];

  const daysToExam = user?.prefs?.examDate
    ? Math.ceil((new Date(user.prefs.examDate).getTime() - Date.now()) / 86_400_000)
    : null;

  const horizonDays = daysToExam && daysToExam > 0 ? Math.min(21, Math.max(3, daysToExam)) : 7;
  const tasks: StudyTask[] = [];

  // Weakest / most-at-risk topics first.
  const ranked = [...overview].sort((a, b) => b.priority - a.priority).slice(0, 8);

  let dayOffset = 0;
  for (const topic of ranked) {
    // Never schedule two heavy items on the same day — spacing beats cramming.
    if (tasks.filter((t) => t.date === isoDay(dayOffset)).length >= 2) dayOffset++;

    const kind: StudyTask['kind'] =
      topic.attempts === 0 ? 'learn' : topic.retention < 0.6 ? 'review' : 'quiz';

    tasks.push({
      id: `${topic.topicId}-${kind}-${dayOffset}`,
      topicId: topic.topicId,
      topicName: topic.name,
      date: isoDay(dayOffset),
      kind,
      title: titleFor(kind, topic),
      rationale: rationaleFor(topic),
      estimatedMin: estimateMinutes(topic, kind),
      done: false,
    });

    // A second touch a couple of days later for anything at risk of decaying.
    if (topic.attempts > 0 && topic.retention < 0.7) {
      const second = Math.min(horizonDays, dayOffset + 2);
      tasks.push({
        id: `${topic.topicId}-spaced-${second}`,
        topicId: topic.topicId,
        topicName: topic.name,
        date: isoDay(second),
        kind: 'quiz',
        title: `Spaced re-check: ${topic.name}`,
        rationale: `Retention decayed to ${Math.round(topic.retention * 100)}%. Spacing beats cramming.`,
        estimatedMin: 8,
        done: false,
      });
    }
  }

  return tasks;
}

function isoDay(offset: number): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function titleFor(kind: StudyTask['kind'], t: TopicMasteryView): string {
  if (kind === 'learn') return `Learn: ${t.name}`;
  if (kind === 'review') return `Review: ${t.name}`;
  return `Quiz: ${t.name}`;
}

function rationaleFor(t: TopicMasteryView): string {
  if (t.attempts === 0) return 'Not studied yet — start here.';
  if (!t.lastReviewedAt) return 'No review recorded.';
  if (t.band === 'weak') return `Weak (${Math.round(t.pLearned * 100)}%) and not reviewed in ${Math.round(t.lastReviewedDaysAgo)} days.`;
  if (!inZPD(t.pLearned)) return `Mastery ${Math.round(t.pLearned * 100)}% — consolidation.`;
  return `Retention at ${Math.round(t.retention * 100)}% after ${Math.round(t.lastReviewedDaysAgo)} days.`;
}

function estimateMinutes(t: TopicMasteryView, kind: StudyTask['kind']): number {
  if (kind === 'learn') return 25;
  if (kind === 'review') return 15;
  return t.band === 'weak' ? 12 : 8;
}

/** Marks a task done and records the event so the streak/schedule react. */
export async function completeTask(userId: string, taskId: string): Promise<boolean> {
  const row = await Event.findOne({ userId, type: 'study_task_done', 'meta.taskId': taskId });
  if (row) return true;
  const { logEvent } = await import('./events.js');
  await logEvent(userId, 'study_task_done', null, null, 'study_plan', { taskId });
  return true;
}

/* ----------------------------- revision -------------------------------- */

export interface Flashcard {
  id: string;
  topicId: string;
  front: string;
  back: string;
  citation: string;
  unitId: string | null;
}

/**
 * Revision material for one topic: flashcards + a slide-style summary.
 * Built extractively from the student's own units so it is grounded by
 * construction, then labelled per card with its citation.
 */
export async function buildRevision(userId: string, topicId: string) {
  const topic = await Topic.findById(topicId).lean();
  if (!topic) return null;

  const units = await retrieveUnits(userId, {
    question: topic.name,
    topicIds: [topicId],
    topK: 12,
  });

  const ai = getAIProvider();
  const flashcards: Flashcard[] = [];
  const summaries: string[] = [];

  for (const unit of units) {
    const sentences = unit.text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 30 && s.length < 240);

    for (const sentence of sentences.slice(0, 3)) {
      if (flashcards.length >= 12) break;
      const front = buildFront(sentence, topic.name);
      if (!front) continue;
      flashcards.push({
        id: `${unit.unitId}-${flashcards.length}`,
        topicId,
        front,
        back: sentence,
        citation: formatCardCitation(unit),
        unitId: unit.unitId,
      });
    }
    if (summaries.length < 6) summaries.push(unit.text.slice(0, 280));
  }

  // Let the model condense the summary bullets when a real model is available.
  if (ai.name === 'gemini' && units.length) {
    try {
      const bullets = await ai.generateJSON<{ bullets?: string[] }>({
        system: 'Summarise strictly from the provided excerpts. Reply with JSON only.',
        prompt: `Summarise these excerpts about "${topic.name}" into at most 6 bullet points.\n\n${summaries.join('\n---\n')}\n\nReply {"bullets":["..."]}`,
      });
      if (bullets.bullets?.length) summaries.length = 0, summaries.push(...bullets.bullets.slice(0, 6));
    } catch {
      /* keep extractive summary */
    }
  }

  return {
    topic: { id: topicId, name: topic.name, summary: topic.summary ?? null, keyConcepts: topic.keyConcepts ?? [] },
    flashcards,
    summarySlides: summaries.map((s, i) => ({ index: i + 1, text: s })),
    audioBrief: null, // TTS is a browser concern; the client uses the Web Speech API.
  };
}

function buildFront(sentence: string, topicName: string): string | null {
  const m = sentence.match(/^(.{4,90}?)\s+(?:is|are|was|were|refers to|means|denotes)\s+(.+)$/i);
  if (m) return `Define: ${m[1].trim()}`;
  if (/^In this (lecture|chapter|section)/i.test(sentence)) return null;
  return `About ${topicName}: what does this state?`;
}

function formatCardCitation(u: { sourceTitle: string; location: Record<string, number | null> }): string {
  const loc = u.location ?? {};
  if (loc.startSec != null) return `${u.sourceTitle} · ${Math.floor(loc.startSec / 60)}:${String(Math.floor(loc.startSec % 60)).padStart(2, '0')}`;
  if (loc.slide != null) return `${u.sourceTitle} · Slide ${loc.slide}`;
  if (loc.page != null) return `${u.sourceTitle} · p.${loc.page}`;
  return u.sourceTitle;
}