import { describe, expect, it } from "vitest";
import {
  albumSystemPrompt,
  buildContext,
  canRegenerate,
  chunkText,
  CHUNK_SIZE,
  DEFAULT_SETTINGS,
  extractJsonObject,
  fillAlbumPrompt,
  fillSongPrompt,
  getVariants,
  guessDocKind,
  imageExt,
  isAudioLost,
  LibraryDoc,
  parseAlbumConcept,
  parseDraft,
  retrieveChunks,
  sanitizeFileName,
  songSystemPrompt,
  summarizeSources,
  SUNO_LIMITS,
  Track,
} from "./index";

function doc(name: string, chunks: string[]): LibraryDoc {
  return { id: name, name, path: name, chunks, kind: "content", addedAt: "2026-01-01" };
}

function track(patch: Partial<Track> = {}): Track {
  return {
    id: "t1",
    taskId: "task",
    title: "Tytuł",
    style: "folk",
    lyrics: "la la",
    sunoModel: "V5",
    provider: "openai",
    instrumental: false,
    status: "SUCCESS",
    createdAt: "2026-01-01T00:00:00Z",
    ...patch,
  };
}

describe("retrieveChunks (BM25)", () => {
  const docs = [
    doc("las.md", ["Ciemny las i stare dęby szumią nocą", "Rzeka płynie przez dolinę"]),
    doc("miasto.md", ["Neony miasta, tramwaje i deszcz", "Dworzec o północy"]),
  ];

  it("ranks the chunk matching the query first", () => {
    const result = retrieveChunks(docs, "tramwaje w deszczu neony", 2);
    expect(result[0].docName).toBe("miasto.md");
    expect(result[0].score).toBeGreaterThan(0);
  });

  it("falls back to an even cross-section when nothing matches", () => {
    const result = retrieveChunks(docs, "kosmos rakieta", 2);
    expect(result.map((r) => r.docName).sort()).toEqual(["las.md", "miasto.md"]);
    expect(result.every((r) => r.score === 0)).toBe(true);
  });

  it("returns nothing for an empty library", () => {
    expect(retrieveChunks([], "cokolwiek")).toEqual([]);
  });

  it("respects k", () => {
    expect(retrieveChunks(docs, "", 3)).toHaveLength(3);
  });
});

describe("buildContext / summarizeSources", () => {
  const chunks = [
    { docName: "a.md", text: "jeden", score: 1 },
    { docName: "a.md", text: "dwa", score: 1 },
    { docName: "b.pdf", text: "trzy", score: 1 },
  ];
  it("labels every fragment with its source", () => {
    expect(buildContext(chunks)).toContain("=== Fragment z: b.pdf ===\ntrzy");
  });
  it("counts fragments per document", () => {
    expect(summarizeSources(chunks)).toBe("a.md (2), b.pdf (1)");
  });
});

describe("prompts", () => {
  it("fills Suno model limits with safety margins", () => {
    const filled = fillSongPrompt("{MAX_STYLE}|{MAX_LYRICS}|{MAX_TITLE}", "V4");
    const l = SUNO_LIMITS.V4;
    expect(filled).toBe(`${l.style - 100}|${l.lyrics - 500}|${l.title - 10}`);
  });

  it("fills the album song count", () => {
    expect(fillAlbumPrompt("x {SONG_COUNT} y {SONG_COUNT}", 7)).toBe("x 7 y 7");
  });

  it("uses the custom song prompt from settings and appends brief and guides", () => {
    const settings = { ...DEFAULT_SETTINGS, songSystemPrompt: "Mój prompt {MAX_TITLE}" };
    const prompt = songSystemPrompt(settings, "V5", "o morzu", "używaj [Choir]");
    expect(prompt.startsWith(`Mój prompt ${SUNO_LIMITS.V5.title - 10}`)).toBe(true);
    expect(prompt).toContain("Wytyczne użytkownika (brief): o morzu");
    expect(prompt).toContain("używaj [Choir]");
  });

  it("falls back to the built-in album prompt when the custom one is blank", () => {
    const prompt = albumSystemPrompt({ ...DEFAULT_SETTINGS, albumSystemPrompt: "  " }, 5, "");
    expect(prompt).toContain("DOKŁADNIE 5 piosenkami");
  });
});

describe("LLM response parsing", () => {
  it("extracts the song object surrounded by chatter and braces", () => {
    const raw = 'Oto {wynik}: {"title": "A", "style": "B {x}", "lyrics": "C"} koniec';
    expect(extractJsonObject(raw)).toBe('{"title": "A", "style": "B {x}", "lyrics": "C"}');
    expect(parseDraft(raw)).toEqual({ title: "A", style: "B {x}", lyrics: "C" });
  });

  it("unwraps a nested object", () => {
    expect(parseDraft('{"song": {"title": "A", "style": "B", "lyrics": "C"}}')).toEqual({
      title: "A",
      style: "B",
      lyrics: "C",
    });
  });

  it("rejects responses without required fields", () => {
    expect(() => parseDraft('{"title": "A"}')).toThrow(/title\/style\/lyrics/);
    expect(() => parseDraft("nie JSON")).toThrow(/poprawnego JSON/);
  });

  it("parses an album concept and rejects an empty plan", () => {
    const concept = {
      albumTitle: "X",
      styleDirection: "folk",
      songs: [{ title: "a", brief: "b", styleHints: "c" }],
    };
    expect(parseAlbumConcept(`plan: ${JSON.stringify(concept)}`)).toEqual(concept);
    expect(() => parseAlbumConcept('{"albumTitle": "X", "songs": []}')).toThrow(/planu albumu/);
  });
});

describe("track variants", () => {
  it("builds variant A from legacy flat fields", () => {
    const variants = getVariants(track({ audioId: "a1", audioUrl: "u" }));
    expect(variants).toEqual([
      {
        audioId: "a1",
        audioUrl: "u",
        streamAudioUrl: undefined,
        imageUrl: undefined,
        duration: undefined,
        wavUrl: undefined,
      },
    ]);
    expect(getVariants(track())).toEqual([]);
  });

  it("treats a variant as lost only when expired without any stored copy", () => {
    expect(isAudioLost({ audioId: "a", audioExpired: true })).toBe(true);
    expect(isAudioLost({ audioId: "a", audioExpired: true, wavStorageId: "s" })).toBe(false);
    expect(isAudioLost({ audioId: "a" })).toBe(false);
  });

  it("allows regeneration only when every variant of a finished track is lost", () => {
    const lost = { audioId: "a", audioExpired: true };
    expect(canRegenerate(track({ variants: [lost, { ...lost, audioId: "b" }] }))).toBe(true);
    expect(canRegenerate(track({ variants: [lost, { audioId: "b" }] }))).toBe(false);
    expect(canRegenerate(track({ status: "FAILED", variants: [lost] }))).toBe(false);
    expect(canRegenerate(track())).toBe(false);
  });
});

describe("text helpers", () => {
  it("chunks on paragraph boundaries and hard-splits long paragraphs", () => {
    const long = "x".repeat(CHUNK_SIZE * 2 + 10);
    const chunks = chunkText(`krótki\n\n${long}\n\nkoniec`);
    expect(chunks[0]).toBe("krótki");
    expect(chunks.slice(1, 4).map((c) => c.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 10]);
    expect(chunks.at(-1)).toBe("koniec");
  });

  it("merges short paragraphs into one chunk", () => {
    expect(chunkText("a\n\nb\n\n\nc")).toEqual(["a\n\nb\n\nc"]);
  });

  it("sanitizes file names and detects image extensions", () => {
    expect(sanitizeFileName('a/b:c*?"<>|d')).toBe("a_b_c______d");
    expect(imageExt("https://cdn/x.PNG?sig=1")).toBe("png");
    expect(imageExt("https://cdn/x")).toBe("jpeg");
  });

  it("guesses guide documents by name", () => {
    expect(guessDocKind("Suno poradnik.md")).toBe("guide");
    expect(guessDocKind("wiersze.txt")).toBe("content");
  });
});
