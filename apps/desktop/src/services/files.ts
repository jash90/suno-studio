import { readFile, readTextFile } from "@tauri-apps/plugin-fs";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import { SourceFile } from "../types";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// ponytail: łączny limit treści źródłowych, żeby nie rozsadzić kontekstu LLM
export const MAX_TOTAL_CHARS = 50_000;

export const SUPPORTED_EXTENSIONS = ["txt", "md", "pdf", "docx"];

function extension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

async function extractPdf(path: string): Promise<string> {
  const data = await readFile(path);
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
    );
  }
  return pages.join("\n\n");
}

async function extractDocx(path: string): Promise<string> {
  const data = await readFile(path);
  const result = await mammoth.extractRawText({
    arrayBuffer: data.buffer as ArrayBuffer,
  });
  return result.value;
}

export async function extractText(path: string): Promise<SourceFile> {
  const ext = extension(path);
  let text: string;
  switch (ext) {
    case "txt":
    case "md":
      text = await readTextFile(path);
      break;
    case "pdf":
      text = await extractPdf(path);
      break;
    case "docx":
      text = await extractDocx(path);
      break;
    default:
      throw new Error(`Nieobsługiwany typ pliku: .${ext}`);
  }
  return { name: fileName(path), path, text: text.trim() };
}

// ponytail: fragmenty ~1200 znaków cięte na granicach akapitów, bez overlapu —
// wystarcza do doboru kontekstu dla LLM; overlap dodać, gdyby fragmenty ucinały wątki
const CHUNK_SIZE = 1200;

export function chunkText(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > CHUNK_SIZE) {
      chunks.push(current);
      current = "";
    }
    // pojedynczy akapit dłuższy niż CHUNK_SIZE tnij twardo
    if (p.length > CHUNK_SIZE) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < p.length; i += CHUNK_SIZE) {
        chunks.push(p.slice(i, i + CHUNK_SIZE));
      }
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
