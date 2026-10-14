export interface PdfIntent {
  kind: 'none' | 'request' | 'ambiguous';
  target: 'previous' | 'new';
  contentQuestion?: string;
}

/** Classify clear PDF requests without confusing questions about PDF as a topic. */
export function detectPdfIntent(question: string): PdfIntent {
  const text = question.trim();
  const hasPdf = /\bpdf\b/i.test(text);
  if (!hasPdf) return { kind: 'none', target: 'new' };

  const ofThisOrThat = /\bpdf\s+(?:of|for)\s+(?:this|that|the\s+(?:previous|last)\s+answer|the\s+answer\s+above)\b/i.test(text);
  const convertMatch = /\b(?:turn|convert)\s+(.+?)\s+into\s+(?:a\s+)?pdf\b/i.exec(text);
  const asPdfMatch = /\b(?:save|export|download|turn|convert)\s+(.+?)\s+(?:as|into)\s+(?:a\s+)?pdf\b/i.exec(text);
  const beforePdfMatch = /\b(?:make|create|generate|prepare)\s+(?:me\s+)?(?:a\s+)?(.+?)\s+(?:as\s+)?(?:a\s+)?pdf\b/i.exec(text);
  const actionBeforePdf = /\b(?:make|create|generate|export|save|download|give|prepare)\b[\s\S]{0,80}\bpdf\b/i.test(text);
  const pdfOfTarget = /\bpdf\s+(?:of|for)\s+(?:this|that|my\s+notes|my\s+upload|my\s+material|the\s+notes|the\s+upload)\b/i.test(text);
  const clearlyRequested = ofThisOrThat || Boolean(convertMatch || asPdfMatch || beforePdfMatch) || actionBeforePdf || pdfOfTarget;

  if (clearlyRequested) {
    const targetText = convertMatch?.[1] ?? asPdfMatch?.[1] ?? (extractTail(text) || beforePdfMatch?.[1] || '');
    const normalizedTarget = targetText.trim().replace(/^[,.:;!?\s]+|[,.:;!?\s]+$/g, '');
    const usefulTarget = normalizedTarget.replace(/^(?:a|an|the|me|you)\s*$/i, '');
    if (!usefulTarget && !pdfOfTarget && !ofThisOrThat) return { kind: 'ambiguous', target: refersToPrevious(text) ? 'previous' : 'new' };
    const previous = ofThisOrThat || refersToPrevious(normalizedTarget);
    const content = previous ? undefined : contentQuestion(normalizedTarget);
    return { kind: 'request', target: previous ? 'previous' : 'new', ...(content ? { contentQuestion: content } : {}) };
  }

  // A short request such as "Could you PDF this?" is ambiguous; let the online
  // tutor make the inexpensive yes/no decision instead of hijacking a topic query.
  if (/\b(?:please|can\s+you|could\s+you|would\s+you|i\s+need|i\s+want)\b/i.test(text)) {
    return { kind: 'ambiguous', target: refersToPrevious(text) ? 'previous' : 'new' };
  }
  return { kind: 'none', target: 'new' };
}

function extractTail(text: string): string {
  const afterVerb = /\b(?:make|create|generate|export|save|download|prepare|give(?:\s+me)?)\b[\s\S]{0,40}?\bpdf\b([\s\S]*)/i.exec(text)?.[1] ?? '';
  return afterVerb.replace(/^\s*(?:of|about|on|explaining|describing|for|from)\s+/i, '').trim();
}

function refersToPrevious(text: string): boolean {
  return /\b(?:this|that|above|previous|last\s+answer|the\s+answer\s+above)\b/i.test(text);
}

function contentQuestion(text: string): string | undefined {
  const value = text.trim().replace(/^[,.:;!?\s]+|[,.:;!?\s]+$/g, '');
  if (!value || refersToPrevious(value)) return undefined;
  if (/^(?:what|why|how|when|where|who|explain|describe|summari[sz]e|compare|define)\b/i.test(value)) return value;
  if (/^(?:my|the)\s+(?:notes|upload|material|document)\b/i.test(value)) return `Summarize ${value}.`;
  return `Explain ${value}.`;
}
