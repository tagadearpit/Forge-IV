import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { splitSentences } from '../utils/text.js';

const exec = promisify(execFile);

export interface RawUnit {
  kind: 'text' | 'figure' | 'transcript';
  text: string;
  location: { page?: number; slide?: number; startSec?: number; endSec?: number };
  figureDescription?: string;
  speakerNotes?: string;
  heading?: string;
}

export class ExtractionError extends Error {
  constructor(message: string, readonly stage: string) {
    super(message);
  }
}

/* ------------------------------- PDF ---------------------------------- */

/**
 * Extracts text page-by-page so every unit keeps a real page number.
 * pdf-parse exposes a per-page render hook, which is the only reliable way to
 * preserve pagination without re-implementing the PDF content stream.
 */
export async function extractPdf(filePath: string): Promise<{ units: RawUnit[]; pageCount: number }> {
  // Lazily required: pdf-parse is CommonJS and touches global state on import.
  const pdfParse = (await import('pdf-parse')).default as unknown as (buf: Buffer) => Promise<{
    numpages: number;
    text: string;
  }>;

  const buf = await fs.promises.readFile(filePath);
  if (buf.length < 5) throw new ExtractionError('File is empty or not a PDF.', 'pdf');

  let parsed: { numpages: number; text: string };
  try {
    parsed = await pdfParse(buf);
  } catch (err) {
    throw new ExtractionError(
      `Could not read this PDF (${(err as Error).message}). It may be corrupted or password-protected.`,
      'pdf'
    );
  }

  // The default parser concatenates pages; re-read per page for exact numbering.
  const pages = await perPageText(buf);
  const units: RawUnit[] = [];

  if (pages.length) {
    pages.forEach((text, i) => {
      const clean = text.trim();
      if (clean) units.push({ kind: 'text', text: clean, location: { page: i + 1 } });
    });
  } else if (parsed.text?.trim()) {
    // Fallback: whole-document text attributed to page 1.
    units.push({ kind: 'text', text: parsed.text.trim(), location: { page: 1 } });
  }

  if (!units.length) {
    throw new ExtractionError(
      'This PDF contains no extractable text. It may be a scanned image — OCR is not enabled in this prototype.',
      'pdf'
    );
  }

  return { units, pageCount: parsed.numpages || pages.length };
}

/**
 * Rebuilds line structure from text-run geometry.
 *
 * pdf.js reports each text run with a transform matrix; transform[5] is the
 * baseline Y and transform[4] the X. Grouping runs by baseline and sorting by X
 * recovers the document's real line breaks. We cannot rely on `hasEOL` here —
 * pdf-parse does not populate it, so the entire page would otherwise arrive as
 * one enormous line and all section headings would be lost.
 */
function reconstructLines(items: any[]): string {
  const rows = new Map<number, Array<{ x: number; str: string }>>();

  for (const item of items) {
    if (typeof item?.str !== 'string' || !item.str) continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    // Round the baseline so sub-pixel jitter does not split one line in two.
    const y = Math.round(t[5] as number);
    const x = (t[4] as number) ?? 0;
    const row = rows.get(y) ?? [];
    row.push({ x, str: item.str });
    rows.set(y, row);
  }

  // Descending Y = top to bottom on the page.
  const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]);
  return ordered
    .map(([, runs]) =>
      runs
        .sort((a, b) => a.x - b.x)
        .map((r) => r.str.trim())
        .filter(Boolean)
        .join(' ')
    )
    .join('\n');
}

async function perPageText(buf: Buffer): Promise<string[]> {
  try {
    const pdfParse = (await import('pdf-parse')).default as any;
    const collected: string[] = [];
    await pdfParse(buf, {
      pagerender: async (pageData: any) => {
        try {
          const tc = await pageData.getTextContent();
          // Respect pdf.js line-end markers. Joining every text item with a
          // space destroys the document's line structure, which loses section
          // headings entirely — and headings are what the topic extractor reads
          // to build the course structure.
          collected.push(reconstructLines(tc.items ?? []));
        } catch {
          collected.push('');
        }
        return '';
      },
    });
    return collected;
  } catch {
    return [];
  }
}

/* ------------------------------- PPTX --------------------------------- */

/**
 * Minimal, dependency-light PPTX reader.
 *
 * A .pptx is an OOXML zip. We walk ppt/slides/slideN.xml in numeric order for
 * the body text (preserving slide numbers), pull ppt/notesSlides/ for speaker
 * notes, and list ppt/media/ so the vision pass knows which slides carry
 * figures. Speaker notes are kept as a separate field on the unit rather than
 * being merged into the slide text — that distinction matters when citing.
 */
export async function extractPptx(filePath: string): Promise<{ units: RawUnit[]; pageCount: number }> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));
  } catch (err) {
    throw new ExtractionError(
      `Could not open this PowerPoint file (${(err as Error).message}). It may be corrupted.`,
      'pptx'
    );
  }

  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (!slideFiles.length) {
    throw new ExtractionError('This file contains no slides.', 'pptx');
  }

  const mediaFiles = Object.keys(zip.files).filter((f) => /^ppt\/media\//.test(f) && !zip.files[f].dir);
  const units: RawUnit[] = [];

  for (const slideFile of slideFiles) {
    const slideNo = slideNumber(slideFile);
    const xml = await zip.files[slideFile].async('string');

    // <a:t> runs hold the visible text. The first short run is commonly the
    // slide title and is retained for the source outline.
    const textRuns = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
      .map((m) => decodeXml(m[1]).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const body = textRuns.join(' ').replace(/\s+/g, ' ').trim();
    const heading = textRuns.find((run) => run.length <= 160) ?? textRuns[0];

    const notesFile = zip.files[`ppt/notesSlides/notesSlide${slideNo}.xml`];
    let notes: string | null = null;
    if (notesFile) {
      const nxml = await notesFile.async('string');
      // Strip the slide-number placeholder that PowerPoint always embeds.
      const ntext = [...nxml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
        .map((m) => decodeXml(m[1]))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      notes = ntext && ntext !== String(slideNo) ? ntext : null;
    }

    const hasMedia = mediaFiles.length > 0;
    const combined = [body, notes].filter(Boolean).join('\n\n');
    if (!combined.trim() && !hasMedia) continue;

    if (combined.trim()) {
      units.push({
        kind: 'text',
        text: combined.trim(),
        location: { slide: slideNo },
        speakerNotes: notes ?? undefined,
        heading: heading ?? undefined,
      });
    }
  }

  if (!units.length) {
    throw new ExtractionError('No readable text was found in this deck.', 'pptx');
  }
  return { units, pageCount: slideFiles.length };
}

function slideNumber(file: string): number {
  return Number(file.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/* ------------------------------ Image --------------------------------- */

export async function extractImage(
  filePath: string,
  mimeType: string,
  describe: (opts: { dataBase64: string; mimeType: string; context?: string }) => Promise<string>
): Promise<{ units: RawUnit[] }> {
  const buf = await fs.promises.readFile(filePath);
  if (buf.length === 0) throw new ExtractionError('Image file is empty.', 'image');

  const description = await describe({
    dataBase64: buf.toString('base64'),
    mimeType,
    context:
      'Describe this figure for a study index in at most 3 sentences. State what is depicted, label any axis or legend, and name the concept it illustrates. Do not speculate beyond what is visible.',
  });

  return {
    units: [
      {
        kind: 'figure',
        text: description,
        figureDescription: description,
        location: { page: 1 },
      },
    ],
  };
}

/* --------------------------- Video / Audio ---------------------------- */

export async function extractAudioFromVideo(filePath: string): Promise<string> {
  const out = filePath.replace(/\.[^.]+$/, '') + '.mp3';
  try {
    await exec('ffmpeg', [
      '-y', '-i', filePath, '-vn', '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', out,
    ], { timeout: 300_000, maxBuffer: 1024 * 1024 * 16 });
  } catch (err) {
    const msg = (err as { stderr?: string }).stderr ?? (err as Error).message;
    if (!fs.existsSync(out)) {
      throw new ExtractionError(
        `Could not extract audio from this video (ffmpeg: ${String(msg).slice(0, 160)}).`,
        'video'
      );
    }
  }
  if (!fs.existsSync(out)) throw new ExtractionError('Audio extraction produced no output.', 'video');
  return out;
}

export async function probeDuration(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await exec(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { timeout: 30_000 }
    );
    const d = Number(stdout.trim());
    return Number.isFinite(d) ? Math.round(d) : null;
  } catch {
    return null;
  }
}

/**
 * Turns transcript segments into 30–60 second units, each keeping an exact
 * [startSec, endSec] range so a citation can seek the player to the right spot.
 * Segments are never split mid-sentence where avoidable.
 */
export function segmentsToUnits(
  segments: Array<{ startSec: number; endSec: number; text: string }>
): RawUnit[] {
  const cleaned = segments
    .map((s) => ({ ...s, text: (s.text ?? '').trim() }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.startSec - b.startSec);

  const units: RawUnit[] = [];
  let bucket: typeof cleaned = [];
  let bucketStart = 0;

  const flush = () => {
    if (!bucket.length) return;
    const text = bucket.map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
    const endSec = bucket[bucket.length - 1].endSec;
    if (text) units.push({ kind: 'transcript', text, location: { startSec: bucketStart, endSec } });
    bucket = [];
  };

  for (const seg of cleaned) {
    if (!bucket.length) bucketStart = seg.startSec;
    bucket.push(seg);
    const span = bucket[bucket.length - 1].endSec - bucketStart;
    // Close the bucket between 30 and 60 seconds, at a sentence boundary.
    const textSoFar = bucket.map((b) => b.text).join(' ');
    const endsSentence = /[.!?]\s*$/.test(textSoFar.trim());
    if (span >= 30 && (span >= 60 || endsSentence)) flush();
  }
  flush();
  return units;
}

/* ------------------------------- Plain text --------------------------- */

export function extractPlainText(content: string): { units: RawUnit[] } {
  const text = (content ?? '').trim();
  if (!text) throw new ExtractionError('The text file was empty.', 'text');
  return {
    units: [{ kind: 'text', text, location: { page: 1 } }],
  };
}

export { splitSentences, path };