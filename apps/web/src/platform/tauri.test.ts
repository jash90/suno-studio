import { beforeEach, describe, expect, it, vi } from "vitest";

// Logika powłoki desktopowej bez prawdziwego Tauri: pluginy podmienione na atrapy
// z pamięciowym systemem plików i store'ami.
const files = new Map<string, Uint8Array>();
const dirs = new Set<string>();
const stores = new Map<string, Map<string, unknown>>();
const dialog = {
  save: vi.fn<() => Promise<string | null>>(),
  open: vi.fn<() => Promise<string | null>>(),
  confirm: vi.fn<() => Promise<boolean>>(),
};

vi.mock("@tauri-apps/plugin-dialog", () => dialog);
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeFile: vi.fn(async (path: string, data: Uint8Array) => void files.set(path, data)),
  readFile: vi.fn(async (path: string) => {
    const data = files.get(path);
    if (!data) throw new Error(`ENOENT ${path}`);
    return data;
  }),
  exists: vi.fn(async (path: string) => files.has(path)),
  mkdir: vi.fn(async (path: string) => void dirs.add(path)),
  remove: vi.fn(async (path: string) => void files.delete(path)),
  stat: vi.fn(async (path: string) => ({ size: files.get(path)?.length ?? 0 })),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));
vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/data",
  join: async (...parts: string[]) => parts.join("/"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(async (url: string) =>
    url.includes("404")
      ? new Response("nope", { status: 404 })
      : new Response(`audio:${url}`, { headers: { "content-type": "audio/mpeg" } })
  ),
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name)!;
    return {
      get: async (key: string) => data.get(key),
      set: async (key: string, value: unknown) => void data.set(key, value),
      save: async () => {},
    };
  }),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

const { default: platform } = await import("./tauri");
const text = (path: string) => new TextDecoder().decode(files.get(path));
/** tauri.ts trzyma uchwyty store'ów — zmieniamy zawartość istniejących map */
function seed(file: string, key: string, value: unknown) {
  if (!stores.has(file)) stores.set(file, new Map());
  stores.get(file)!.set(key, value);
}

beforeEach(() => {
  files.clear();
  dirs.clear();
  for (const data of stores.values()) data.clear();
  vi.clearAllMocks();
});

describe("tauri platform — saving", () => {
  it("writes to the default folder without asking", async () => {
    await platform.desktop!.setDefaultSaveDir("/Users/me/Music");
    const path = await platform.saveFile({ data: "tekst" }, "Pieśń.txt");
    expect(path).toBe("/Users/me/Music/Pieśń.txt");
    expect(text(path!)).toBe("tekst");
    expect(dialog.save).not.toHaveBeenCalled();
  });

  it("asks where to save when no default folder is set, and respects cancel", async () => {
    dialog.save.mockResolvedValueOnce("/tmp/x.mp3").mockResolvedValueOnce(null);
    expect(await platform.saveFile({ url: "https://cdn/a.mp3" }, "x.mp3")).toBe("/tmp/x.mp3");
    expect(text("/tmp/x.mp3")).toBe("audio:https://cdn/a.mp3");
    expect(await platform.saveFile({ url: "https://cdn/a.mp3" }, "x.mp3")).toBeNull();
  });

  it("takes the default folder from legacy desktop settings on first run", async () => {
    seed("settings.json", "settings", { defaultSaveDir: "/legacy" });
    expect(await platform.desktop!.getDefaultSaveDir()).toBe("/legacy");
    await platform.desktop!.setDefaultSaveDir("");
    expect(await platform.desktop!.getDefaultSaveDir()).toBe(""); // świadome „pytaj zawsze”
  });

  it("saves an album as a subfolder and reports per-file errors", async () => {
    dialog.open.mockResolvedValueOnce("/Volumes/Disk");
    const progress: number[] = [];
    const result = await platform.saveBundle(
      [
        { name: "01 - A (A).mp3", url: "https://cdn/1.mp3" },
        { name: "02 - B (A).mp3", url: "https://cdn/404.mp3" },
        { name: "teksty.txt", data: "la la" },
      ],
      "Ogień: i Popiół (A+B)",
      (done) => progress.push(done)
    );
    const dir = "/Volumes/Disk/Ogień_ i Popiół (A+B)";
    expect(result).toMatchObject({ saved: 2, location: dir });
    expect(result.errors).toEqual(["02 - B (A).mp3: Pobieranie nie powiodło się (HTTP 404)"]);
    expect(dirs.has(dir)).toBe(true);
    expect(text(`${dir}/teksty.txt`)).toBe("la la");
    expect(progress).toEqual([0, 1, 2, 3]);
  });

  it("cancelling the folder picker saves nothing", async () => {
    dialog.open.mockResolvedValueOnce(null);
    expect(await platform.saveBundle([{ name: "a", data: "x" }], "Album")).toEqual({
      saved: 0,
      errors: [],
      location: null,
    });
    expect(files.size).toBe(0);
  });
});

describe("tauri platform — local data I/O (silnik desktopu)", () => {
  const desktop = platform.desktop!;

  it("reads and writes the same store files as the old desktop app", async () => {
    seed("history.json", "tracks", [{ id: "t1" }]);
    expect(await desktop.readStore("history.json", "tracks")).toEqual([{ id: "t1" }]);
    await desktop.writeStore("history.json", "tracks", []);
    expect(stores.get("history.json")!.get("tracks")).toEqual([]);
  });

  it("writes data files under the app data dir and serves them back via asset URLs", async () => {
    const path = await desktop.writeDataFile("audio/t1-a.mp3", new Blob(["mp3"]));
    expect(path).toBe("/data/audio/t1-a.mp3");
    expect(dirs.has("/data/audio")).toBe(true);
    expect(await desktop.fileSize(path)).toBe(3);

    // zapis „Pobierz MP3” z archiwum na dysku czyta plik, nie idzie przez HTTP
    const url = desktop.fileUrl(path);
    const saved = await platform.saveFile({ url }, "kopia.mp3");
    expect(saved).toBeNull(); // brak folderu domyślnego i dialog anulowany
    dialog.save.mockResolvedValueOnce("/Users/me/kopia.mp3");
    await platform.saveFile({ url }, "kopia.mp3");
    expect(text("/Users/me/kopia.mp3")).toBe("mp3");

    await desktop.removeFile(path);
    expect(files.has(path)).toBe(false);
  });
});
