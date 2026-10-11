/**
 * Text utilities: tokenisation, sentence splitting and chunking.
 * Deliberately dependency-free so the ingestion pipeline behaves identically
 * whether the Gemini provider or the offline provider is active.
 */

const STOPWORDS = new Set(
  `a an the and or but if then else when while of to in on at by for with from as is are was were be been being do does did doing have has had having i you he she it we they them this that these those there here what which who whom whose why how all any both each few more most other some such no nor not only own same so than too very can will just should now would could may might must shall about into over under again further once because while during before after above below between through during about against among across behind beyond toward upon within without`
    .split(/\s+/)
    .filter(Boolean)
);

/** Words that signal a domain concept regardless of corpus statistics. */
export function contentWords(input: string): string[] {
  return tokenize(input).filter((t) => !STOPWORDS.has(t) && t.length > 2);
}

export function tokenize(input: string): string[] {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean);
}

/** Splits text into sentences, keeping the terminator with each sentence. */
export function splitSentences(input: string): string[] {
  if (!input) return [];
  const normalised = input.replace(/\s+/g, ' ').trim();
  // Guard against abbreviations that would otherwise cause spurious splits.
  const guarded = normalised
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Fig|Eq|No|vs|etc|e\.g|i\.e|St|approx)\./gi, '$1<DOT>');
  return guarded
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(\[])/)
    .map((s) => s.replace(/<DOT>/g, '.').trim())
    .filter((s) => s.length > 0);
}

/** Rough token estimate that works for both Gemini and local accounting. */
export function estimateTokens(input: string): number {
  if (!input) return 0;
  // ~4 characters per token is close enough for chunk-size budgeting.
  return Math.ceil(input.length / 4);
}

/**
 * Splits text into overlapping chunks of roughly `targetTokens` tokens with a
 * `overlapTokens` tail repeated at the head of the next chunk. Overlap keeps
 * a definition or a sentence boundary from being severed mid-thought.
 */
export function chunkText(
  text: string,
  targetTokens = 400,
  overlapTokens = 60
): Array<{ text: string; charStart: number; charEnd: number }> {
  const clean = (text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const approxChars = targetTokens * 4;
  const overlapChars = Math.max(0, overlapTokens * 4);

  // Prefer paragraph boundaries; fall back to sentences; last resort hard cut.
  const blocks = clean
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const chunks: Array<{ text: string; charStart: number; charEnd: number }> = [];
  let cursor = 0;

  while (cursor < clean.length) {
    let end = Math.min(cursor + approxChars, clean.length);

    if (end < clean.length) {
      // Try to land on a paragraph break, then a sentence break, inside the window.
      const window = clean.slice(cursor, end);
      const paraBreak = window.lastIndexOf('\n\n');
      if (paraBreak > approxChars * 0.4) {
        end = cursor + paraBreak;
      } else {
        const sentences = splitSentences(window);
        if (sentences.length > 1) {
          let acc = 0;
          for (let i = 0; i < sentences.length - 1; i++) {
            acc += sentences[i].length + 1;
            if (acc > approxChars * 0.6) {
              end = cursor + acc;
              break;
            }
          }
        }
      }
    }

    const slice = clean.slice(cursor, end).trim();
    if (slice) {
      const lead = clean.slice(cursor, end).length - clean.slice(cursor, end).trimStart().length;
      chunks.push({
        text: slice,
        charStart: cursor + lead,
        charEnd: cursor + lead + slice.length,
      });
    }

    if (end >= clean.length) break;
    // Step forward by the window size minus the overlap tail.
    cursor = Math.max(end - overlapChars, cursor + 1);
    // Snap FORWARD to the next word boundary. Skipping whitespace instead
    // lands mid-token ("...t|he offset..."), which corrupts the first word of
    // every subsequent chunk — visible in generated answers.
    while (cursor < clean.length && !/\s/.test(clean[cursor])) cursor++;
    while (cursor < clean.length && /\s/.test(clean[cursor])) cursor++;
  }

  return chunks;
}

/** Normalises text for fingerprinting: lowercase, strip punctuation, collapse space. */
export function normalizeForFingerprint(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, used as a second dedupe signal alongside embeddings. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function titleCase(input: string): string {
  return (input || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}