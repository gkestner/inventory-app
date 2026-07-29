declare module "pdf-lib/dist/pdf-lib.esm.js" {
  export const PDFDocument: {
    load(bytes: ArrayBuffer): Promise<{
      getPageCount(): number;
      copyPages(source: unknown, indices: number[]): Promise<unknown[]>;
      addPage(page: unknown): void;
      save(): Promise<Uint8Array>;
    }>;
    create(): Promise<{
      getPageCount(): number;
      copyPages(source: unknown, indices: number[]): Promise<unknown[]>;
      addPage(page: unknown): void;
      save(): Promise<Uint8Array>;
    }>;
  };
}
