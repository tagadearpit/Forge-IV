export interface PdfIntent {
  kind: 'none' | 'request' | 'ambiguous';
  target: 'previous' | 'new';
  contentQuestion?: string;
}

export interface PdfIntentDecision {
  makePdf: boolean;
  target?: 'previous' | 'new';
  contentQuestion?: string | null;
}

export interface PdfTurnResolution {
  intent: PdfIntent;
  effectiveQuestion: string;
  cancelled: boolean;
}

/** Pull a standalone cancellation or a cancellation prefix off a pending-PDF reply. */
export function extractPdfCancellation(question: string): string | null {
  const match = question.trim().match(/^(?:please\s+)?(?:cancel(?:\s+(?:that|it|the\s+pdf|the\s+request))?|never\s+mind|nevermind|forget\s+(?:the\s+pdf|that|it|the\s+request))(?:\s*(?:[,;:.!?]+\s*|\s+then\s+|\s+and\s+)?)?([\s\S]*)$/i);
  return match ? match[1].trim() : null;
}

/** Resolve a reply to an outstanding clarification, preserving explicit new PDF requests. */
export function resolvePdfTurn(question: string, pendingPdf: boolean): PdfTurnResolution {
  const remainder = pendingPdf ? extractPdfCancellation(question) : null;
  const effectiveQuestion = remainder === null ? question : remainder;
  let intent = detectPdfIntent(effectiveQuestion);
  if (pendingPdf && remainder === null && intent.kind === 'none') {
    intent = detectPdfIntent(`Create a PDF about ${question}`);
  }
  return { intent, effectiveQuestion, cancelled: remainder !== null };
}

const PDF_ACTION = /^(?:(?:now|please)\s+)*(?:(?:can|could|would)\s+you\s+)?(?:(?:i\s+(?:need|want)\s+(?:you\s+to\s+)?)?)(?:make|create|generate|prepare|export|save|download|turn|convert|give(?:\s+me)?)\b/i;
const PDF_AS_VERB = /^(?:(?:please)\s+)?(?:(?:can|could|would)\s+you\s+)?pdf\s+(?:this|that|it|the\s+(?:previous|last)\s+answer)\b/i;
const PREVIOUS_REFERENCE = /\b(?:this|that|it|above|previous|preceding|last\s+answer|the\s+answer\s+above|that\s+answer)\b/i;
const QUESTION_START = /^(?:what|why|how|when|where|who)\b/i;

/**
 * Classify explicit PDF commands without treating generic output nouns such as
 * "document" or "report" as the subject. This parser is deterministic and
 * deliberately leaves only genuinely unclear wording for optional AI help.
 */
export function detectPdfIntent(question: string): PdfIntent {
  const text = question.trim().replace(/\s+/g, ' ');
  const pdfMatch = /\bpdf\b/i.exec(text);
  if (!pdfMatch) return { kind: 'none', target: 'new' };

  // Questions about PDFs (including how to create them) remain ordinary tutor
  // questions, even when they contain action verbs later in the sentence.
  if (QUESTION_START.test(text)) return { kind: 'none', target: 'new' };

  const beforePdf = text.slice(0, pdfMatch.index);
  const afterPdf = text.slice(pdfMatch.index + pdfMatch[0].length).trim();
  const actionMatch = PDF_ACTION.exec(text);
  const verbRequest = PDF_AS_VERB.test(text);
  const requestLike = Boolean(actionMatch) || verbRequest || /\b(?:i\s+(?:need|want))\s+(?:a\s+)?pdf\b/i.test(text);

  if (!requestLike) {
    // Mentioning PDF without an action is usually a topic question; only route
    // uncertain imperative-like phrases to a follow-up, never silently to QA.
    if (/^(?:please|can\s+you|could\s+you|would\s+you)\b/i.test(text)) {
      return { kind: 'ambiguous', target: PREVIOUS_REFERENCE.test(text) ? 'previous' : 'new' };
    }
    return { kind: 'none', target: 'new' };
  }

  const prefixTarget = actionMatch
    ? beforePdf.slice(actionMatch[0].length).replace(/\b(?:as|into)\s*$/i, '').trim().replace(/^(?:a|an|the)\s+/i, '').replace(/^(?:a|an|the)$/i, '')
    : '';
  const afterTarget = stripGenericDocumentWording(afterPdf);
  const rawTarget = [prefixTarget, afterTarget].filter(Boolean).join(' ').trim();
  const target = rawTarget.replace(/^[,.:;!?\s]+|[,.:;!?\s]+$/g, '').replace(/^(?:a|an|the)\s+/i, '');

  if (PREVIOUS_REFERENCE.test(target)) return { kind: 'request', target: 'previous' };

  if (!target) {
    // Polite modal requests are genuinely under-specified; unlike a bare
    // imperative, do not guess whether they mean a new document or prior reply.
    if (/(?:can|could|would)\s+you\b/i.test(text)) return { kind: 'ambiguous', target: 'new' };
    // "about/on/explaining ..." with no subject is incomplete; generic "Make a
    // PDF" / "Create a PDF document" means export the current answer if any.
    if (/^(?:about|on|explaining|describing|covering|containing)\b/i.test(afterPdf)) {
      return { kind: 'ambiguous', target: 'new' };
    }
    return { kind: 'request', target: 'previous' };
  }

  const normalized = target
    .replace(/^(?:of|for|about|on|explaining|describing|covering|containing|with\s+content\s+about)\s+/i, '')
    .replace(/^(?:a|an|the)\s+/i, '')
    .trim();
  if (!normalized) return { kind: 'request', target: 'previous' };
  if (PREVIOUS_REFERENCE.test(normalized)) return { kind: 'request', target: 'previous' };

  const contentQuestion = makePdfContentQuestion(normalized);
  return contentQuestion
    ? { kind: 'request', target: 'new', contentQuestion }
    : { kind: 'ambiguous', target: 'new' };
}

function stripGenericDocumentWording(value: string): string {
  let text = value.replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '').trim();
  // "document explaining X" / "report about X": remove the output noun and
  // the connective verb, preserving X as the actual requested subject.
  text = text.replace(/^(?:a|an|the)\s+/i, '');
  text = text.replace(/^(?:document|file|report|handout|study\s+guide)\b\s*/i, '');
  text = text.replace(/^(?:of|for|about|on|explaining|to\s+explain|describing|to\s+describe|covering|containing)\b\s*/i, '');
  text = text.replace(/^(?:a|an|the)\s+/i, '');
  return text.replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '').trim();
}

export function makePdfContentQuestion(subject: string): string | undefined {
  const value = subject.trim().replace(/^[,.:;!?\s]+|[,.:;!?\s]+$/g, '');
  if (!value) return undefined;
  if (/^(?:document|file|report|handout|study\s+guide)$/i.test(value)) return undefined;
  if (/^(?:explain|describe|summari[sz]e|compare|define)\b/i.test(value)) {
    const verb = value.match(/^(explain|describe|summari[sz]e|compare|define)\b/i)?.[1] ?? 'Explain';
    const rest = value.replace(/^(?:explain|describe|summari[sz]e|compare|define)\b\s*/i, '').trim();
    if (!rest) return undefined;
    const normalizedVerb = verb.toLowerCase().startsWith('summari') ? 'Summarize' : verb[0].toUpperCase() + verb.slice(1).toLowerCase();
    return `${normalizedVerb} ${rest.replace(/[.?!]+$/, '')}.`;
  }
  if (/^(?:what|why|how|when|where|who)\b/i.test(value)) {
    return /[?]$/.test(value) ? value : `${value}?`;
  }
  if (/^(?:my|the)\s+(?:notes|upload|material|document)\b/i.test(value)) return `Summarize ${value}.`;
  return `Explain ${value.replace(/[.?!]+$/, '')}.`;
}

/**
 * Optional classifier for only genuinely ambiguous phrasing. Failure preserves
 * the ambiguity so the route asks a safe follow-up rather than answering as if
 * no PDF had been requested.
 */
export async function classifyAmbiguousPdfIntent(
  intent: PdfIntent,
  classify?: () => Promise<PdfIntentDecision>
): Promise<PdfIntent> {
  if (intent.kind !== 'ambiguous' || !classify) return intent;
  try {
    const decision = await classify();
    if (!decision.makePdf) return { kind: 'none', target: 'new' };
    if (decision.target === 'previous') return { kind: 'request', target: 'previous' };
    const contentQuestion = decision.contentQuestion ? makePdfContentQuestion(decision.contentQuestion) : undefined;
    return contentQuestion
      ? { kind: 'request', target: 'new', contentQuestion }
      : { kind: 'ambiguous', target: 'new' };
  } catch {
    return intent;
  }
}
