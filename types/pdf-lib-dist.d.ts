declare module "pdf-lib/dist/pdf-lib.esm.js" {
  type Font = { widthOfTextAtSize(text: string, size: number): number };
  type Page = {
    drawText(text: string, options: Record<string, unknown>): void;
    drawRectangle(options: Record<string, unknown>): void;
  };
  type Document = {
    getPageCount(): number;
    copyPages(source: unknown, indices: number[]): Promise<unknown[]>;
    addPage(size: [number, number]): Page;
    embedFont(name: string): Promise<Font>;
    save(): Promise<Uint8Array>;
  };
  export const PDFDocument: {
    load(bytes: ArrayBuffer): Promise<Document>;
    create(): Promise<Document>;
  };
  export const StandardFonts: { Helvetica: string; HelveticaBold: string };
  export function rgb(red: number, green: number, blue: number): unknown;
}
