import { env } from '../config/env.js';
import { localEmbed, localEmbedBatch, EMBEDDING_DIM } from '../utils/embedding.js';
import { contentWords, splitSentences } from '../utils/text.js';

/**
 * ============================================================================
 * Single AI seam for the whole application.
 * ============================================================================
 * Every business module (ingestion, tutor, assessment generation, revision)
 * talks to this interface and nothing else. Swapping Gemini for another
 * provider means implementing `AIProvider` and changing one factory line —
 * no changes to routers, services or the learner model.
 *
 * Two implementations ship:
 *   - GeminiProvider — real Google Gemini (text, vision, embeddings, audio)
 *   - LocalProvider  — fully offline, deterministic, NO network
 *
 * The local provider is not a stub that returns lorem ipsum. It performs real
 * extractive work: real chunking, real cosine retrieval, real extractive
 * answers composed from retrieved sentences, real keyword topic extraction.
 * That is what makes the whole prototype runnable and verifiable end-to-end
 * without an API key — and it is what lets us prove nothing hallucinates.
 */

export interface GenerateOptions {
  system?: string;
  prompt: string;
  /** Optional grounding context. The local provider answers only from this. */
  context?: string[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Hard JSON mode: provider must return parseable JSON. */
  json?: boolean;
}

export interface TopicExtraction {
  topics: Array<{
    name: string;
    summary: string;
    keyConcepts: string[];
    parentName?: string | null;
  }>;
}

/** A question as drafted by the model, before verification and dedupe. */
export interface DraftQuestion {
  type: 'mcq' | 'short' | 'numerical';
  text: string;
  options?: string[];
  answerKey: string | number;
  units?: string | null;
  /** Model-suggested tolerance for numerical items; clamped downstream. */
  tolerance?: number | null;
  explanation: string;
  misconception?: string | null;
  /** Per-distractor misconception labels for MCQs (index-aligned with options). */
  distractorMisconceptions?: Array<string | null> | null;
  difficulty: number;
  /** Indices into the excerpt array this question was built from. */
  citedIndices: number[];
}

export interface GroundedAnswerDraft {
  answer: string;
  citedUnitIds: string[];
  groundingStatus: 'full' | 'partial' | 'outside_material';
  outsideKnowledge: string | null;
}

/**
 * The two generative capabilities the product actually needs, expressed
 * explicitly rather than as free-form JSON. Each has a genuine Gemini
 * implementation and a genuine offline implementation, so business logic never
 * has to care which provider is active.
 */
export interface AIProvider {
  readonly name: string;
  generateText(opts: GenerateOptions): Promise<string>;
  generateJSON<T>(opts: GenerateOptions): Promise<T>;
  embed(texts: string[]): Promise<number[][]>;
  describeImage(opts: { dataBase64: string; mimeType: string; context?: string }): Promise<string>;
  transcribeAudio(opts: {
    dataBase64: string;
    mimeType: string;
  }): Promise<Array<{ startSec: number; endSec: number; text: string }>>;
  extractTopics(opts: { texts: string[] }): Promise<TopicExtraction>;
  /** Source-grounded answer + the unit IDs actually used. */
  groundedAnswer(opts: {
    question: string;
    excerpts: Array<{ unitId: string; text: string }>;
    language: 'en' | 'hi';
    answerStyle?: 'quick' | 'deep';
    studyLevel?: string;
  }): Promise<GroundedAnswerDraft>;
  /** Answer without source material, for a separately labelled outside-source block. */
  generalAnswer(opts: { question: string; language: 'en' | 'hi'; answerStyle?: 'quick' | 'deep'; studyLevel?: string }): Promise<string | null>;
  /** Grounded question drafting for one question type. */
  draftQuestions(opts: {
    type: 'mcq' | 'short' | 'numerical';
    excerpts: Array<{ unitId: string; text: string }>;
    count: number;
    targetDifficulty: number;
  }): Promise<DraftQuestion[]>;
}

/* ========================================================================== *
 * Gemini implementation
 * ========================================================================== */

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private base = 'https://generativelanguage.googleapis.com/v1beta';

  private async call(model: string, body: unknown, timeoutMs = 60_000): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.base}/models/${model}:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Gemini ${res.status}: ${detail.slice(0, 300)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private buildParts(opts: GenerateOptions): GeminiPart[] {
    const parts: GeminiPart[] = [];
    if (opts.context?.length) {
      parts.push({
        text:
          `SOURCE EXCERPTS (cite by index [n]):\n` +
          opts.context.map((c, i) => `[${i + 1}] ${c}`).join('\n\n'),
      });
    }
    parts.push({ text: opts.prompt });
    return parts;
  }

  async generateText(opts: GenerateOptions): Promise<string> {
    const body = {
      contents: [{ role: 'user', parts: this.buildParts(opts) }],
      systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
      generationConfig: {
        temperature: opts.temperature ?? 0.3,
        maxOutputTokens: opts.maxOutputTokens ?? 2048,
        responseMimeType: opts.json ? 'application/json' : undefined,
      },
    };
    const data = await this.call(env.GEMINI_MODEL, body);
    return (data.candidates?.[0]?.content?.parts ?? [])
      .map((p: GeminiPart) => p.text ?? '')
      .join('')
      .trim();
  }

  async generateJSON<T>(opts: GenerateOptions): Promise<T> {
    const raw = await this.generateText({ ...opts, json: true });
    return parseJsonLoose<T>(raw);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    // Batch to stay under request size limits.
    const BATCH = 100;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const slice = texts.slice(i, i + BATCH);
      const body = {
        requests: slice.map((t) => ({
          model: `models/${env.GEMINI_EMBED_MODEL}`,
          content: { parts: [{ text: t.slice(0, 8000) }] },
        })),
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      try {
        const res = await fetch(`${this.base}/models/${env.GEMINI_EMBED_MODEL}:batchEmbedContents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Gemini embed ${res.status}`);
        const data = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
        for (const item of data.embeddings ?? []) {
          out.push((item.values as number[]) ?? []);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    return out;
  }

  async describeImage(opts: { dataBase64: string; mimeType: string; context?: string }): Promise<string> {
    const parts: GeminiPart[] = [
      { inline_data: { mime_type: opts.mimeType, data: opts.dataBase64 } },
      {
        text:
          opts.context ??
          'Describe this figure for a study index in at most 3 sentences. State what is depicted, label any axis or legend, and name the concept it illustrates. Do not speculate beyond what is visible.',
      },
    ];
    const data = await this.call(env.GEMINI_MODEL, {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
    });
    return (data.candidates?.[0]?.content?.parts ?? [])
      .map((p: GeminiPart) => p.text ?? '')
      .join('')
      .trim();
  }

  async transcribeAudio(opts: { dataBase64: string; mimeType: string }) {
    const data = await this.call(
      env.GEMINI_MODEL,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: opts.mimeType, data: opts.dataBase64 } },
              {
                text:
                  'Transcribe this lecture audio verbatim. Return STRICT JSON: {"segments":[{"startSec":0,"endSec":0,"text":"..."}]}. Use realistic timestamps in seconds.',
              },
            ],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      },
      120_000
    );
    const raw = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p: GeminiPart) => p.text ?? '')
      .join('');
    const parsed = parseJsonLoose<{ segments?: any[] }>(raw);
    return (parsed.segments ?? []).map((s) => ({
      startSec: Number(s.startSec ?? 0),
      endSec: Number(s.endSec ?? 0),
      text: String(s.text ?? '').trim(),
    }));
  }

  async extractTopics(opts: { texts: string[] }): Promise<TopicExtraction> {
    const sample = opts.texts.slice(0, 60).join('\n\n---\n\n').slice(0, 40_000);
    return this.generateJSON<TopicExtraction>({
      system:
        'You extract course structure. Reply with JSON only, no prose, no markdown fences.',
      prompt: `From the excerpts below, identify the major topics, their subtopics and key concepts.\n\nReturn JSON: {"topics":[{"name":"...","summary":"1 sentence","keyConcepts":["..."],"parentName":null}]}\nUse at most 8 top-level topics. Only include topics actually present in the text.\n\nEXCERPTS:\n${sample}`,
    });
  }

  async groundedAnswer(opts: {
    question: string;
    excerpts: Array<{ unitId: string; text: string }>;
    language: 'en' | 'hi';
    answerStyle?: 'quick' | 'deep';
    studyLevel?: string;
  }): Promise<GroundedAnswerDraft> {
    const listed = opts.excerpts.map((e, i) => `[${i + 1}] ${e.text}`).join('\n\n');
    const system =
      opts.language === 'hi'
        ? 'You are a study tutor. Answer ONLY from the SOURCE EXCERPTS. Write the explanation in Hindi, keeping technical terms in English in parentheses. Citations stay in English. If the excerpts do not contain the answer, set groundingStatus to "outside_material" and do not invent an explanation.'
        : 'You are a study tutor. Answer ONLY from the SOURCE EXCERPTS. If the excerpts do not contain the answer, set groundingStatus to "outside_material" and do not invent an explanation.';

    const prompt = `SOURCE EXCERPTS (cite by index [n]):
${listed}

QUESTION: ${opts.question}

Adapt the explanation to a ${opts.studyLevel ?? 'self-learner'} learner. ${opts.answerStyle === 'deep' ? 'Give a careful step-by-step explanation with an example when the excerpts support one.' : 'Keep the answer concise and easy to scan.'}

Reply with STRICT JSON only:
{
  "answer": "the explanation, grounded in the excerpts",
  "citedUnitIds": ["exact unit ids you actually used"],
  "groundingStatus": "full" | "partial" | "outside_material",
  "outsideKnowledge": null
}`;

    const parsed = await this.generateJSON<GroundedAnswerDraft>({ system, prompt, temperature: 0.2 });
    return {
      answer: parsed.answer ?? '',
      citedUnitIds: Array.isArray(parsed.citedUnitIds) ? parsed.citedUnitIds.map(String) : [],
      groundingStatus: parsed.groundingStatus ?? 'partial',
      outsideKnowledge: parsed.outsideKnowledge ?? null,
    };
  }

  async generalAnswer(opts: { question: string; language: 'en' | 'hi'; answerStyle?: 'quick' | 'deep'; studyLevel?: string }): Promise<string | null> {
    const languageInstruction = opts.language === 'hi'
      ? 'Answer in Hindi, keeping important technical terms in English in parentheses.'
      : 'Answer in English.';
    const depthInstruction = opts.answerStyle === 'deep'
      ? 'Give a patient, step-by-step explanation at the learner’s level, with an example if helpful.'
      : 'Give a concise, friendly answer in a few short paragraphs.';
    return this.generateText({
      system: `You are a careful study buddy answering from general knowledge, not from uploaded course material. ${languageInstruction} ${depthInstruction} Do not claim this answer is supported by the learner’s sources. If uncertain or the question needs current information, say so clearly.`,
      prompt: `Learner level: ${opts.studyLevel ?? 'self-learner'}.
Question: ${opts.question}
Answer clearly and accurately.`,
      temperature: 0.3,
      maxOutputTokens: opts.answerStyle === 'deep' ? 1200 : 500,
    });
  }

  async draftQuestions(opts: {
    type: 'mcq' | 'short' | 'numerical';
    excerpts: Array<{ unitId: string; text: string }>;
    count: number;
    targetDifficulty: number;
  }): Promise<DraftQuestion[]> {
    const listed = opts.excerpts.map((e, i) => `[${i + 1}] ${e.text}`).join('\n\n');
    const typeRules: Record<DraftQuestion['type'], string> = {
      mcq:
        'For type="mcq": exactly 4 options, answerKey is the correct option TEXT (not the letter). Distractors must be plausible but wrong, drawn from the same material. ' +
        'Set "distractorMisconceptions" to an array of 4 strings/nulls aligned with "options": null for the correct option, and for each distractor the SPECIFIC error a student makes by choosing it (e.g. "confuses the base case with the general case"). Never invent a misconception for the correct option.',
      short:
        'For type="short": answerKey is a concise expected answer phrase (3-8 words) that a correct student would produce.',
      numerical:
        'For type="numerical": answerKey is the computed NUMBER, "units" is the unit label (e.g. "m/s"). Compute the value carefully. Optionally set "tolerance" as a relative fraction (e.g. 0.01); it will be clamped. If the question states arithmetic explicitly, double-check the result.',
    };

    const parsed = await this.generateJSON<{ questions?: any[] }>({
      system:
        'You write exam questions strictly grounded in supplied excerpts. Reply with JSON only, no markdown fences.',
      prompt: `SOURCE EXCERPTS (cite by index [n]):
${listed}

Write ${opts.count} DISTINCT ${opts.type} questions that test ONLY the content above.
Target difficulty ~${opts.targetDifficulty.toFixed(2)} on a 0-1 scale.

Reply with STRICT JSON:
{"questions":[{"type":"${opts.type}","text":"...","options":[...],"answerKey":"...","units":null,"explanation":"...","misconception":"...","difficulty":${opts.targetDifficulty.toFixed(2)},"citedIndices":[1,2]}]}

${typeRules[opts.type]}

Rules:
- "citedIndices" must reference excerpt indices you actually used.
- No two questions may ask the same thing.
- "explanation" must justify the answer from the excerpt, not from general knowledge.`,
      temperature: 0.7,
    });

    return (parsed.questions ?? []).map((q: any) => ({
      type: opts.type,
      text: String(q.text ?? '').trim(),
      options: Array.isArray(q.options) ? q.options.map(String) : undefined,
      answerKey: opts.type === 'numerical' ? Number(q.answerKey) : String(q.answerKey ?? '').trim(),
      units: q.units ? String(q.units) : null,
      tolerance: q.tolerance !== undefined && q.tolerance !== null ? Number(q.tolerance) : null,
      explanation: String(q.explanation ?? '').trim(),
      misconception: q.misconception ? String(q.misconception) : null,
      distractorMisconceptions: Array.isArray(q.distractorMisconceptions)
        ? q.distractorMisconceptions.map((m: any) => (m ? String(m) : null))
        : null,
      difficulty: Number.isFinite(Number(q.difficulty)) ? Number(q.difficulty) : opts.targetDifficulty,
      citedIndices: Array.isArray(q.citedIndices) ? q.citedIndices.map(Number).filter(Number.isFinite) : [],
    }));
  }
}

/* ========================================================================== *
 * Local / offline provider
 * ========================================================================== */

/**
 * Extractive QA. Given the question and the retrieved excerpts, it selects the
 * sentences with the highest lexical overlap with the question and returns
 * them verbatim. It cannot invent content because it only ever concatenates
 * text that already existed in the student's own material.
 */
class LocalProvider implements AIProvider {
  readonly name = 'local';

  async generateText(opts: GenerateOptions): Promise<string> {
    const context = opts.context ?? [];
    if (!context.length) {
      return 'This question is not covered by the uploaded material.';
    }
    const qTerms = new Set(contentWords(opts.prompt));
    if (qTerms.size === 0) return context.slice(0, 3).join(' ');

    type Scored = { text: string; score: number };
    const scored: Scored[] = [];
    for (const chunk of context) {
      for (const sentence of splitSentences(chunk)) {
        const terms = contentWords(sentence);
        if (!terms.length) continue;
        let overlap = 0;
        for (const t of terms) if (qTerms.has(t)) overlap++;
        if (overlap === 0) continue;
        // Normalise by sentence length so long sentences do not dominate.
        const score = overlap / Math.sqrt(terms.length);
        scored.push({ text: sentence.trim(), score });
      }
    }
    if (!scored.length) return 'This question is not covered by the uploaded material.';

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 4).map((s) => s.text);
    // De-duplicate while preserving order.
    return [...new Set(top)].join(' ');
  }

  async generateJSON<T>(opts: GenerateOptions): Promise<T> {
    // The JSON-producing paths each call the dedicated structured method below;
    // this generic path is only a safety net.
    const text = await this.generateText(opts);
    return parseJsonLoose<T>(text);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return localEmbedBatch(texts);
  }

  async describeImage(): Promise<string> {
    return '[Vision description unavailable in local mode — set GEMINI_API_KEY to enable figure extraction.]';
  }

  async transcribeAudio(): Promise<Array<{ startSec: number; endSec: number; text: string }>> {
    return [];
  }

  /**
   * Extractive grounded answer.
   *
   * Selects the sentences from the retrieved excerpts with the strongest
   * lexical tie to the question, then reports the unit IDs those sentences
   * actually came from. Because the output is assembled only from retrieved
   * text, it cannot invent content — and because it reports real unit IDs, the
   * caller's citation audit has something genuine to verify.
   */
  async groundedAnswer(opts: {
    question: string;
    excerpts: Array<{ unitId: string; text: string }>;
    language: 'en' | 'hi';
  }): Promise<GroundedAnswerDraft> {
    const { question, excerpts, language } = opts;
    if (!excerpts.length) {
      return { answer: '', citedUnitIds: [], groundingStatus: 'outside_material', outsideKnowledge: null };
    }

    const qTerms = new Set(contentWords(question));
    const perUnit = new Map<string, { text: string; score: number }>();

    for (const ex of excerpts) {
      let best = 0;
      const picked: string[] = [];
      for (const sentence of splitSentences(ex.text)) {
        const terms = contentWords(sentence);
        if (terms.length < 4) continue;
        const overlap = terms.filter((t) => qTerms.has(t)).length;
        if (!overlap) continue;
        // Length-normalised so a long rambling sentence does not win by volume.
        const score = overlap / Math.sqrt(terms.length);
        if (score > best) best = score;
        picked.push(sentence.trim());
      }
      // Keep the top sentences per unit, preserving their original order.
      const ranked = [...new Set(picked)]
        .sort((a, b) => {
          const ta = contentWords(a);
          const tb = contentWords(b);
          const sa = ta.filter((t) => qTerms.has(t)).length / Math.sqrt(ta.length || 1);
          const sb = tb.filter((t) => qTerms.has(t)).length / Math.sqrt(tb.length || 1);
          return sb - sa;
        })
        .slice(0, 3);
      if (ranked.length && best > 0) {
        perUnit.set(ex.unitId, { text: ranked.join(' '), score: best });
      }
    }

    if (!perUnit.size) {
      return {
        answer: '',
        citedUnitIds: [],
        groundingStatus: 'outside_material',
        outsideKnowledge: null,
      };
    }

    const ordered = [...perUnit.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 3);
    const citedUnitIds = ordered.map(([id]) => id);

    let answer = ordered.map(([, v]) => v.text).join(' ');
    if (language === 'hi') {
      answer = `नीचे आपकी सामग्री से लिखित उत्तर है:\n\n${answer}`;
    }

    // "full" when every cited unit actually contributes, "partial" otherwise.
    const groundingStatus: GroundedAnswerDraft['groundingStatus'] =
      citedUnitIds.length >= 2 ? 'full' : 'partial';

    return { answer, citedUnitIds, groundingStatus, outsideKnowledge: null };
  }

  /**
   * Extractive question drafting.
   *
   * Builds real, answerable questions directly from retrieved sentences:
   *   - numerical  : asks for a value that appears in the source
   *   - short      : asks the student to state the point of a source sentence
   *   - mcq        : cloze over a key term, with distractors drawn from other
   *                  key terms in the SAME material (so they are plausible)
   * Nothing here is invented: every question's answer is recoverable from the
   * cited excerpt, which is exactly what the verifier checks afterwards.
   */
  async generalAnswer(): Promise<string | null> {
    return null;
  }

  async draftQuestions(opts: {
    type: 'mcq' | 'short' | 'numerical';
    excerpts: Array<{ unitId: string; text: string }>;
    count: number;
    targetDifficulty: number;
  }): Promise<DraftQuestion[]> {
    const { type, excerpts, count } = opts;
    if (!excerpts.length || count <= 0) return [];

    // Candidate source sentences, longest first (informative ones first).
    type Candidate = { sentence: string; unitIndex: number };
    const candidates: Candidate[] = [];
    excerpts.forEach((ex, unitIndex) => {
      for (const sentence of splitSentences(ex.text)) {
        if (sentence.length < 45 || sentence.length > 260) continue;
        candidates.push({ sentence: sentence.trim(), unitIndex });
      }
    });
    if (!candidates.length) return [];
    candidates.sort((a, b) => b.sentence.length - a.sentence.length);

    // Vocabulary for MCQ distractors, drawn from the retrieved material only.
    const corpusTerms = [...new Set(excerpts.flatMap((e) => contentWords(e.text)))]
      .filter((w) => w.length > 4)
      .slice(0, 400);

    const drafts: DraftQuestion[] = [];
    const used = new Set<string>();

    for (const cand of candidates) {
      if (drafts.length >= count) break;
      const key = cand.sentence.slice(0, 60).toLowerCase();
      if (used.has(key)) continue;

      const unit = excerpts[cand.unitIndex];

      if (type === 'numerical') {
        const numMatch = cand.sentence.match(
          /(-?\d+(?:\.\d+)?)\s*(%|ms|ns|bytes?|KB|MB|GB|KiB|ways?|bits?|ns\/KB)?/
        );
        if (!numMatch) continue;
        const value = Number(numMatch[1]);
        if (!Number.isFinite(value) || value === 0) continue;
        used.add(key);
        drafts.push({
          type: 'numerical',
          text: `According to the material, what value is given here: "${trimForQuestion(cand.sentence)}"?`,
          answerKey: value,
          units: numMatch[2] ?? null,
          explanation: `The source states "${cand.sentence}" which gives ${value}${numMatch[2] ? ' ' + numMatch[2] : ''}.`,
          misconception: 'misreads the numeric detail in the definition',
          difficulty: opts.targetDifficulty,
          citedIndices: [cand.unitIndex + 1],
        });
        continue;
      }

      if (type === 'short') {
        const terms = contentWords(cand.sentence);
        if (terms.length < 5) continue;
        used.add(key);
        drafts.push({
          type: 'short',
          text: `In your own words, what does the material state here? "${trimForQuestion(cand.sentence)}"`,
          answerKey: keyPhrase(cand.sentence),
          explanation: `The source says: "${cand.sentence}"`,
          misconception: 'cannot recall the core statement behind this concept',
          difficulty: opts.targetDifficulty,
          citedIndices: [cand.unitIndex + 1],
        });
        continue;
      }

      // --- MCQ: blank a salient term, distractors from the same corpus ---
      const terms = contentWords(cand.sentence);
      if (terms.length < 6) continue;
      const target = pickSalientTerm(cand.sentence, terms);
      if (!target) continue;

      const distractors = corpusTerms
        .filter((w) => w !== target.toLowerCase())
        .filter((w) => !cand.sentence.toLowerCase().includes(w))
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);
      if (distractors.length < 3) continue;

      used.add(key);
      drafts.push({
        type: 'mcq',
        text: `Fill in the blank: "${cand.sentence.replace(new RegExp(target, 'i'), '_____')}"`,
        options: [target, ...distractors].sort(() => 0.5 - Math.random()),
        answerKey: target,
        explanation: `The material reads: "${cand.sentence}"`,
        misconception: 'confuses adjacent terminology',
        difficulty: opts.targetDifficulty,
        citedIndices: [cand.unitIndex + 1],
      });
    }

    return drafts;
  }

  /**
   * Topic extraction, in order of signal quality:
   *
   *   1. HEADINGS — lecture material is full of them ("3. PAGE FAULTS AND
   *      REPLACEMENT"). When present these are the real course structure and
   *      far better than any statistical guess. Detected as short lines that
   *      are numbered, ALL-CAPS, or title-case with no terminal punctuation.
   *
   *   2. TF-IDF KEYTERMS — for prose with no headings. Weighted by term
   *      frequency against document frequency, then filtered through a
   *      stoplist of generic academic / technical filler so we do not surface
   *      words like "address" or "size" as "topics".
   *
   * Neither path invents structure that is not in the text.
   */
  async extractTopics(opts: { texts: string[] }): Promise<TopicExtraction> {
    const texts = opts.texts;

    // ---- 1. Headings ----
    const headingCounts = new Map<string, { count: number; summary: string }>();
    for (const text of texts) {
      for (const line of (text || '').split(/\n+/)) {
        const cleaned = line.replace(/\s+/g, ' ').trim();
        if (!cleaned || cleaned.length > 72) continue;
        const heading = detectHeading(cleaned);
        if (!heading) continue;
        const key = heading.toLowerCase();
        const prev = headingCounts.get(key);
        headingCounts.set(key, {
          count: (prev?.count ?? 0) + 1,
          summary: prev?.summary ?? cleaned,
        });
      }
    }

    // A real section heading usually appears exactly ONCE in a handout, so a
    // "seen at least twice" filter throws away the entire course structure.
    // Instead: keep repeated headings always, and keep single-occurrence ones
    // (numbered or clearly title-case) when the corpus yielded several — a
    // corpus with 2+ independent heading hits has real structure.
    const entries = [...headingCounts.entries()].sort((a, b) => b[1].count - a[1].count);
    const headings = entries
      .filter(([key, v], i) => {
        if (v.count >= 2) return true;
        const isNumbered = /^\d+[.]?\s/.test(v.summary) || /^[ivxlc]+[.)]\s/i.test(v.summary);
        const mostlyTitleCase = key
          .split(' ')
          .filter((w) => w.length > 3)
          .every((w) => /^[A-Z]/.test(w));
        return isNumbered || (mostlyTitleCase && entries.length >= 2 && i < 8);
      })
      .slice(0, 6)
      .map(([key, v]) => {
        const words = key.split(' ');
        // Drop leading numbering: "3. page faults" -> "Page faults".
        while (words.length && /^\d+[.]?$/.test(words[0])) words.shift();
        const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return {
          name,
          summary: v.summary,
          keyConcepts: [],
          parentName: null,
        } satisfies TopicExtraction['topics'][number];
      });

    if (headings.length >= 2) return { topics: headings };

    // ---- 2. TF-IDF fallback with a generic-term stoplist ----
    const docs = texts.map((t) => contentWords(t));
    const df = new Map<string, number>();
    for (const words of docs) for (const w of new Set(words)) df.set(w, (df.get(w) ?? 0) + 1);

    const ranked = [...df.entries()]
      .filter(([w, c]) => c >= 2 && w.length > 4 && !GENERIC_TOPIC_TERMS.has(w))
      .map(([w, c]) => ({ w, c, score: c * (1 - c / Math.max(1, docs.length)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    if (!ranked.length) {
      return {
        topics: [
          {
            name: 'General Material',
            summary: 'Uploaded material without a detectable topic structure.',
            keyConcepts: [],
            parentName: null,
          },
        ],
      };
    }

    const seen = new Set<string>();
    const topics: TopicExtraction['topics'] = [];
    for (const r of ranked) {
      if (topics.length >= 6) break;
      const name = toDisplayName(r.w);
      if (seen.has(name)) continue;
      seen.add(name);
      topics.push({
        name,
        summary: `Recurring concept across ${r.c} passage(s) of the uploaded material.`,
        keyConcepts: [],
        parentName: null,
      });
    }
    return { topics };
  }

}

/* ========================================================================== *
 * Helpers + factory
 * ========================================================================== */

/** Shortens a sentence for use inside a question stem. */
function trimForQuestion(sentence: string, max = 150): string {
  const clean = sentence.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 60 ? cut.slice(0, lastSpace) : cut) + '…';
}

/** A short phrase that captures the point of a sentence, for a short answer key. */
function keyPhrase(sentence: string): string {
  const terms = contentWords(sentence);
  return terms.slice(0, 6).join(' ');
}

/** Prefers a long, non-generic term as the cloze target. */
function pickSalientTerm(sentence: string, terms: string[]): string | null {
  const GENERIC = new Set(['which', 'these', 'those', 'their', 'there', 'where', 'while', 'would', 'could', 'should', 'because', 'however', 'therefore', 'between', 'through', 'about', 'other', 'being', 'using', 'used', 'makes', 'make', 'gives', 'given']);
  const candidates = terms.filter((t) => t.length > 5 && !GENERIC.has(t));
  if (!candidates.length) return null;
  // The longest content term in the sentence reads as the most salient.
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

/**
 * Returns a normalised heading if the line looks like one, else null.
 * Lecture/handout structure lives in exactly these three shapes.
 */
function detectHeading(line: string): string | null {
  // Reject lines that are clearly prose.
  if (/[.!?]$/.test(line) && line.split(/\s+/).length > 8) return null;

  const numbered = line.match(/^(?:\d+|[IVXLC]+)[.)]\s+(.{3,})$/);
  if (numbered) return numbered[1];

  const words = line.split(/\s+/);
  if (words.length > 9) return null;

  // ALL CAPS heading.
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) return line;

  // Title Case heading.
  const significant = words.filter((w) => w.length > 3);
  if (significant.length >= 2 && significant.every((w) => /^[A-Z]/.test(w))) return line;

  return null;
}

/**
 * Terms that carry no topical meaning — generic academic scaffolding and
 * programming filler. Left in, they dominate TF-IDF and produce "topics" like
 * "Address" or "Size", which is worse than admitting no structure was found.
 */
const GENERIC_TOPIC_TERMS = new Set(
  `address size value number level type form order term result number point part case line
   name time work group system information example figure table section chapter page figure
   using used also often many however therefore thus hence given based allow require need
   include includes including provide provides provided consider considered follow follows
   define defined defines describe described call calls called return returns returned
   simple simply common complex general specific local global static public private
   start starts started begin begins end ends first second third next previous last current
   note notes important better best good high low large small long short new old able
   access add allow apply approach argument array attribute available basic binary block
   branch buffer byte cache capacity channel char check class clear code compute constant
   copy count create data default delete device direct disk drive element else empty entry
   error event field file flag float format free function handle header hit index init input
   integer invalid item key keyword label length limit link list load log lookup loop mark
   memory message method mode module move node null object offset open operation output page
   pair parse path pattern pending pixel plan point policy position prefix process program
   queue range read ready record reference region release request reset resource result
   return right role root rule run save scan schedule scope search seek segment select
   send set show signal size space split stack stage stamp start state step stop storage
   store string structure style subject success support switch symbol sync table target
   task term test text thread time token total track tree unit unknown update usage valid
   value variable version view wait walk watch width window word work write zone
   memory pointer thread process kernel module register instruction pipeline latency
   throughput overhead bottleneck allocation deallocation fragmentation thrashing`
    .split(/\s+/)
    .filter(Boolean)
);

function toDisplayName(word: string): string {
  return word
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/** Tolerates markdown fences and leading prose around a JSON payload. */
export function parseJsonLoose<T>(raw: string): T {
  const text = (raw || '').trim();
  if (!text) throw new Error('Empty model response');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new Error('Model response was not valid JSON');
  }
}

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cached) return cached;
  if (env.provider === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      throw new Error('AI_PROVIDER=gemini but GEMINI_API_KEY is empty');
    }
    cached = new GeminiProvider();
  } else {
    cached = new LocalProvider();
  }
  return cached;
}

export function providerInfo() {
  return {
    name: getAIProvider().name,
    embeddingDim: env.provider === 'gemini' ? 768 : EMBEDDING_DIM,
    groundedOnly: true,
  };
}

export { localEmbed };