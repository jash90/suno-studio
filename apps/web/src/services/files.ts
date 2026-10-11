import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import { fileExtension, SourceFile } from "@suno/core";

export { chunkText, MAX_TOTAL_CHARS, SUPPORTED_EXTENSIONS } from "@suno/core";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

async function extractPdf(data: ArrayBuffer): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n\n");
}

async function extractDocx(data: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer: data });
  return result.value;
}

/** Wyciąga tekst z pliku wybranego w przeglądarce (drag&drop lub picker). */
export async function extractText(file: File): Promise<SourceFile> {
  const ext = fileExtension(file.name);
  let text: string;
  switch (ext) {
    case "txt":
    case "md":
      text = await file.text();
      break;
    case "pdf":
      text = await extractPdf(await file.arrayBuffer());
      break;
    case "docx":
      text = await extractDocx(await file.arrayBuffer());
      break;
    default:
      throw new Error(`Nieobsługiwany typ pliku: .${ext}`);
  }
  return { name: file.name, path: file.name, text: text.trim() };
}
