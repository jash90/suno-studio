import { LibraryDoc, RetrievedChunk } from "../types";

// Lokalny retrieval leksykalny (BM25) po fragmentach biblioteki.
// ponytail: bez embeddingów — zero kosztów API i działa offline; jeśli dobór
// fragmentów okaże się za słaby, podmienić scoring na embeddingi OpenAI.

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-ząćęłńóśźż0-9]+/i)
    .filter((t) => t.length > 2);
}

const K1 = 1.5;
const B = 0.75;

export function retrieveChunks(
  docs: LibraryDoc[],
  query: string,
  k = 8
): RetrievedChunk[] {
  const all: { docName: string; text: string; tokens: string[] }[] = [];
  for (const doc of docs) {
    for (const chunk of doc.chunks) {
      all.push({ docName: doc.name, text: chunk, tokens: tokenize(chunk) });
    }
  }
  if (all.length === 0) return [];

  const queryTerms = [...new Set(tokenize(query))];

  // Brak sensownego zapytania → weź fragmenty po równo z każdego dokumentu
  if (queryTerms.length === 0) {
    const result: RetrievedChunk[] = [];
    let index = 0;
    while (result.length < Math.min(k, all.length)) {
      for (const doc of docs) {
        if (result.length >= k) break;
        const chunk = doc.chunks[index];
        if (chunk !== undefined) {
          result.push({ docName: doc.name, text: chunk, score: 0 });
        }
      }
      index++;
      if (index > Math.max(...docs.map((d) => d.chunks.length))) break;
    }
    return result;
  }

  const N = all.length;
  const avgLen = all.reduce((sum, c) => sum + c.tokens.length, 0) / N;
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    df.set(term, all.filter((c) => c.tokens.includes(term)).length);
  }

  const scored = all.map((chunk) => {
    let score = 0;
    for (const term of queryTerms) {
      const tf = chunk.tokens.filter((t) => t === term).length;
      if (tf === 0) continue;
      const idf = Math.log(1 + (N - df.get(term)! + 0.5) / (df.get(term)! + 0.5));
      score +=
        (idf * tf * (K1 + 1)) /
        (tf + K1 * (1 - B + (B * chunk.tokens.length) / avgLen));
    }
    return { docName: chunk.docName, text: chunk.text, score };
  });

  const relevant = scored.filter((c) => c.score > 0);
  // Gdy nic nie pasuje do briefu, lepiej dać przekrój biblioteki niż nic
  if (relevant.length === 0) return retrieveChunks(docs, "", k);
  return relevant.sort((a, b) => b.score - a.score).slice(0, k);
}

/** Buduje blok kontekstu dla LLM z pobranych fragmentów. */
export function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => `=== Fragment z: ${c.docName} ===\n${c.text}`)
    .join("\n\n");
}

/** Zwięzłe podsumowanie użytych źródeł, np. "notatki.md (3), praca.pdf (2)". */
export function summarizeSources(chunks: RetrievedChunk[]): string {
  const counts = new Map<string, number>();
  for (const c of chunks) counts.set(c.docName, (counts.get(c.docName) ?? 0) + 1);
  return [...counts.entries()].map(([name, n]) => `${name} (${n})`).join(", ");
}
