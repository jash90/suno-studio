import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, sanitizeAlbum, sanitizeSettings } from "./index";

describe("sanitizeSettings", () => {
  it("keeps known, correctly typed fields and drops the rest", () => {
    const s = sanitizeSettings({
      openaiKey: "  sk-1  ",
      provider: "openai",
      sunoModel: "V4_5",
      showBalances: false,
      defaultSaveDir: "/x",
      hacked: true,
    });
    expect(s).toEqual({
      ...DEFAULT_SETTINGS,
      openaiKey: "sk-1",
      provider: "openai",
      sunoModel: "V4_5",
      showBalances: false,
    });
  });

  it("falls back to defaults for invalid values", () => {
    const s = sanitizeSettings({
      provider: "gemini",
      sunoModel: "V9",
      showBalances: "yes",
      openaiModel: "",
    });
    expect(s.provider).toBe(DEFAULT_SETTINGS.provider);
    expect(s.sunoModel).toBe(DEFAULT_SETTINGS.sunoModel);
    expect(s.showBalances).toBe(DEFAULT_SETTINGS.showBalances);
    expect(s.openaiModel).toBe(DEFAULT_SETTINGS.openaiModel);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("sanitizeAlbum", () => {
  it("normalizes songs from an LLM plan and drops malformed ones", () => {
    const album = sanitizeAlbum({
      id: "a1",
      title: "Ogień",
      styleDirection: "folk",
      brief: "b",
      createdAt: "2026-01-01",
      extra: 1,
      songs: [
        { plan: { title: "1", brief: "b", styleHints: "s", mood: "x" }, status: "planned" },
        { plan: { title: "2" }, status: "bogus", draft: { title: "t", style: "s", lyrics: "l" } },
        { title: "no plan" },
      ],
    });
    expect(album).toEqual({
      id: "a1",
      title: "Ogień",
      styleDirection: "folk",
      brief: "b",
      createdAt: "2026-01-01",
      songs: [
        { plan: { title: "1", brief: "b", styleHints: "s" }, status: "planned" },
        {
          plan: { title: "2", brief: "", styleHints: "" },
          status: "planned",
          draft: { title: "t", style: "s", lyrics: "l" },
        },
      ],
    });
  });

  it("rejects input without a songs array", () => {
    expect(sanitizeAlbum({ title: "x" })).toBeNull();
    expect(sanitizeAlbum("x")).toBeNull();
  });
});
