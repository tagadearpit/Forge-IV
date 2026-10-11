/**
 * Minimal dependency-free PDF writer.
 *
 * The seed script needs a real, multi-page, text-extractable PDF so judges can
 * exercise the ingestion pipeline without hunting for a file. Pulling in
 * pdfkit for that would be overkill, and hand-rolling keeps the seed runnable
 * with zero extra installs.
 */

interface Page {
  lines: string[];
}

function escapePdf(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Lays out plain text into fixed-width pages at a given font size, wrapping on
 * word boundaries. Helvetica 11pt on Letter gives roughly 92 chars per line.
 */
function layout(paragraphs: string[], maxLinesPerPage = 46): Page[] {
  const pages: Page[] = [];
  let current: Page = { lines: [] };

  const pushLine = (line: string) => {
    if (current.lines.length >= maxLinesPerPage) {
      pages.push(current);
      current = { lines: [] };
    }
    current.lines.push(line);
  };

  for (const para of paragraphs) {
    if (para === '') {
      pushLine('');
      continue;
    }
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      if ((line + ' ' + word).trim().length > 92) {
        pushLine(line.trim());
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    if (line.trim()) pushLine(line.trim());
  }
  if (current.lines.length) pages.push(current);
  return pages.length ? pages : [{ lines: [''] }];
}

export function buildPdf(paragraphs: string[]): Buffer {
  const pages = layout(paragraphs);

  // ---- content streams ----
  const streams = pages.map((page) => {
    let text = 'BT\n/F1 11 Tf\n14 TL\n72 720 Td\n';
    page.lines.forEach((line, i) => {
      if (i > 0) text += 'T*\n';
      text += `(${escapePdf(line)}) Tj\n`;
    });
    text += 'ET';
    return text;
  });

  // ---- assemble objects ----
  // 1 catalog, 2 pages, 3..(3+n) page objects, then content streams, then font.
  const objects: string[] = [];
  const pageObjStart = 3;
  const contentObjStart = pageObjStart + pages.length;
  const fontObj = contentObjStart + pages.length;

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(
    `<< /Type /Pages /Kids [${pages
      .map((_, i) => `${pageObjStart + i} 0 R`)
      .join(' ')}] /Count ${pages.length} >>`
  );

  pages.forEach((_, i) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontObj} 0 R >> >> ` +
        `/Contents ${contentObjStart + i} 0 R >>`
    );
  });

  streams.forEach((s) => {
    objects.push(`<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`);
  });

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  // ---- serialise with a correct xref table ----
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}