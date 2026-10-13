import { contentWords, splitSentences } from '../utils/text.js';

export interface AnswerExcerpt { unitId: string; text: string }

/** True for long near-verbatim source dumps or answers polluted with OCR headers. */
export function isUnhelpfulExcerptDump(answer: string, excerpts: AnswerExcerpt[]): boolean {
  if (answer.trim().length < 250) return false;
  if (/\b(monograph series|reference vol(?:ume)?|all rights reserved|table of contents)\b/i.test(answer)) return true;
  const answerWords = contentWords(answer);
  if (answerWords.length < 50) return false;
  const sourceWords = new Set(excerpts.flatMap((excerpt) => contentWords(excerpt.text)));
  const copiedRatio = answerWords.filter((word) => sourceWords.has(word)).length / answerWords.length;
  const isStructured = /(^|\n)\s*(?:#{1,3}\s|[-*]\s|\d+[.)]\s)/m.test(answer);
  return copiedRatio > 0.84 && answer.length > 700 && !isStructured;
}

/**
 * Produce readable, source-only Markdown from excerpts when a generative call is
 * unavailable (or when the local deterministic provider is active). The chosen
 * heading follows the question instead of repeating one fixed answer template.
 */
export function makeReadableExtractiveAnswer(
  question: string,
  excerpts: AnswerExcerpt[],
  language: 'en' | 'hi' = 'en'
) {
  const queryTerms = new Set(contentWords(question));
  const candidates: Array<{ unitId: string; sentence: string; score: number; order: number }> = [];
  let order = 0;

  for (const excerpt of excerpts) {
    for (const raw of splitSentences(excerpt.text)) {
      const sentence = raw.replace(/\s+/g, ' ').trim();
      const words = contentWords(sentence);
      if (sentence.length < 42 || sentence.length > 420 || words.length < 8 || isDocumentNoise(sentence, words.length)) continue;
      const overlap = words.reduce((count, word) => count + (queryTerms.has(word) ? 1 : 0), 0);
      const score = queryTerms.size ? overlap / Math.sqrt(words.length) : 0;
      candidates.push({ unitId: excerpt.unitId, sentence, score, order: order++ });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  const selected: typeof candidates = [];
  const seenSentences = new Set<string>();
  const perUnit = new Map<string, number>();
  for (const candidate of candidates) {
    const key = normalizeSentence(candidate.sentence);
    if (!key || seenSentences.has(key) || (perUnit.get(candidate.unitId) ?? 0) >= 2) continue;
    selected.push(candidate);
    seenSentences.add(key);
    perUnit.set(candidate.unitId, (perUnit.get(candidate.unitId) ?? 0) + 1);
    if (selected.length >= 5) break;
  }

  if (!selected.length) return { answer: '', citedUnitIds: [] as string[] };
  const first = selected[0];
  const details = selected.slice(1);
  const heading = questionHeading(question, language);
  const shortLabel = language === 'hi' ? 'संक्षिप्त उत्तर' : 'Short answer';
  const answer = details.length
    ? `**${shortLabel}**\n\n${first.sentence}\n\n### ${heading}\n\n${details.map((item) => `- ${item.sentence}`).join('\n')}`
    : `**${shortLabel}**\n\n${first.sentence}`;
  return { answer, citedUnitIds: [...new Set(selected.map((item) => item.unitId))] };
}

function questionHeading(question: string, language: 'en' | 'hi'): string {
  if (language === 'hi') {
    if (/\bhow\b/i.test(question)) return 'यह कैसे काम करता है';
    if (/\bwhy\b/i.test(question)) return 'यह क्यों महत्वपूर्ण है';
    if (/\b(?:compare|difference|versus|vs\.?)\b/i.test(question)) return 'मुख्य अंतर';
    if (/\b(?:define|meaning|what is)\b/i.test(question)) return 'इसका अर्थ';
    if (/\b(?:steps?|process|sequence)\b/i.test(question)) return 'मुख्य चरण';
    return 'मुख्य विचार';
  }
  if (/\bhow\b/i.test(question)) return 'How it works';
  if (/\bwhy\b/i.test(question)) return 'Why it matters';
  if (/\b(?:compare|difference|versus|vs\.?)\b/i.test(question)) return 'Key differences';
  if (/\b(?:define|meaning|what is)\b/i.test(question)) return 'What it means';
  if (/\b(?:steps?|process|sequence)\b/i.test(question)) return 'Main steps';
  return 'Key ideas';
}

function isDocumentNoise(sentence: string, wordCount: number): boolean {
  if (/\b(monograph series|reference vol(?:ume)?|all rights reserved|isbn|table of contents|copyright)\b/i.test(sentence)) return true;
  const letters = sentence.match(/[A-Za-z]/g) ?? [];
  const uppercase = sentence.match(/[A-Z]/g) ?? [];
  if (letters.length > 12 && uppercase.length / letters.length > 0.58) return true;
  const singleLetters = sentence.match(/\b[A-Za-z]\b/g) ?? [];
  return wordCount >= 8 && singleLetters.length / wordCount > 0.2;
}

function normalizeSentence(sentence: string): string {
  return sentence.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
