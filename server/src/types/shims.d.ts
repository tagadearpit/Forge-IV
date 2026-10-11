/**
 * pdf-parse ships no type declarations. We declare the minimal surface we use
 * rather than pulling in @types/pdf-parse (which is for an incompatible fork).
 */
declare module 'pdf-parse' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
    text: string;
  }
  type Pagerender = (pageData: unknown) => Promise<string>;
  function pdfParse(data: Buffer | string, options?: { pagerender?: Pagerender }): Promise<PdfParseResult>;
  export default pdfParse;
}
