import { fetch } from "@tauri-apps/plugin-http";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { PersonaModel, SongDraft, SunoModel, TrackStatus, TrackVariant } from "../types";

const BASE = "https://api.sunoapi.org/api/v1";

const ERROR_MESSAGES: Record<string, string> = {
  CREATE_TASK_FAILED: "Nie udało się utworzyć zadania w Suno",
  GENERATE_AUDIO_FAILED: "Generowanie audio nie powiodło się",
  CALLBACK_EXCEPTION: "Błąd po stronie Suno (callback)",
  SENSITIVE_WORD_ERROR: "Suno odrzuciło treść jako wrażliwą — zmień tekst lub styl",
};

interface SunoEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

async function sunoFetch<T>(
  path: string,
  sunoKey: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sunoKey}`,
      ...init?.headers,
    },
  });
  const body: SunoEnvelope<T> = await res.json();
  if (!res.ok || body.code !== 200) {
    throw new Error(`Suno API (${body.code ?? res.status}): ${body.msg ?? "nieznany błąd"}`);
  }
  return body.data;
}

export async function createTask(
  sunoKey: string,
  draft: SongDraft,
  model: SunoModel,
  instrumental: boolean,
  persona?: { id: string; model: PersonaModel }
): Promise<string> {
  const data = await sunoFetch<{ taskId: string }>("/generate", sunoKey, {
    method: "POST",
    body: JSON.stringify({
      customMode: true,
      instrumental,
      model,
      prompt: instrumental ? undefined : draft.lyrics,
      style: draft.style,
      title: draft.title,
      personaId: persona?.id,
      personaModel: persona?.model,
      // Aplikacja desktopowa nie ma publicznego URL — status sprawdzamy pollingiem,
      // a callBackUrl jest wymaganym polem, więc podajemy zaślepkę.
      callBackUrl: "https://example.com/suno-callback",
    }),
  });
  return data.taskId;
}

/** Tworzy personę Suno z ukończonego utworu (audio może dać personę tylko raz). */
export async function createPersona(
  sunoKey: string,
  params: { taskId: string; audioId: string; name: string; description: string }
): Promise<string> {
  const data = await sunoFetch<{ personaId: string }>(
    "/generate/generate-persona",
    sunoKey,
    { method: "POST", body: JSON.stringify(params) }
  );
  return data.personaId;
}

export interface TaskUpdate {
  status: TrackStatus;
  error?: string;
  variants?: TrackVariant[];
  // pola pierwszego wariantu — zgodność wstecz z istniejącą historią
  audioId?: string;
  audioUrl?: string;
  streamAudioUrl?: string;
  imageUrl?: string;
  duration?: number;
}

interface RecordInfo {
  status: string;
  errorMessage?: string | null;
  response?: {
    sunoData?: Array<{
      id?: string;
      audioUrl?: string;
      streamAudioUrl?: string;
      imageUrl?: string;
      duration?: number;
    }>;
  };
}

export async function getTaskStatus(
  sunoKey: string,
  taskId: string
): Promise<TaskUpdate> {
  const data = await sunoFetch<RecordInfo>(
    `/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    sunoKey
  );
  const sunoData = data.response?.sunoData ?? [];
  const variants: TrackVariant[] = sunoData
    .filter((s) => s.id)
    .map((s) => ({
      audioId: s.id!,
      audioUrl: s.audioUrl || undefined,
      streamAudioUrl: s.streamAudioUrl || undefined,
      imageUrl: s.imageUrl || undefined,
      duration: s.duration,
    }));
  const first = variants[0];
  const media = {
    variants: variants.length > 0 ? variants : undefined,
    audioId: first?.audioId,
    audioUrl: first?.audioUrl,
    streamAudioUrl: first?.streamAudioUrl,
    imageUrl: first?.imageUrl,
    duration: first?.duration,
  };
  switch (data.status) {
    case "PENDING":
    case "TEXT_SUCCESS":
    case "FIRST_SUCCESS":
    case "SUCCESS":
      return { status: data.status as TrackStatus, ...media };
    default:
      return {
        status: "FAILED",
        error:
          ERROR_MESSAGES[data.status] ??
          data.errorMessage ??
          `Błąd Suno: ${data.status}`,
      };
  }
}

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

/** Polluje status zadania aż do SUCCESS/FAILED, wołając onUpdate przy każdej zmianie. */
export async function pollTask(
  sunoKey: string,
  taskId: string,
  onUpdate: (update: TaskUpdate) => void
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    let update: TaskUpdate;
    try {
      update = await getTaskStatus(sunoKey, taskId);
    } catch (e) {
      // ponytail: chwilowy błąd sieci nie przerywa pollingu — próbujemy dalej
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    onUpdate(update);
    if (update.status === "SUCCESS" || update.status === "FAILED") return;
    await sleep(POLL_INTERVAL_MS);
  }
  onUpdate({ status: "FAILED", error: "Przekroczono czas oczekiwania (10 min)" });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getCredits(sunoKey: string): Promise<number> {
  return sunoFetch<number>("/generate/credit", sunoKey);
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_");
}

/** Pobiera plik audio bezpośrednio pod wskazaną ścieżkę (bez dialogu). */
export async function downloadToPath(url: string, path: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pobieranie nie powiodło się (HTTP ${res.status})`);
  await writeFile(path, new Uint8Array(await res.arrayBuffer()));
}

async function downloadWithDialog(
  url: string,
  suggestedName: string,
  ext: string,
  filterLabel: string
): Promise<boolean> {
  const target = await save({
    defaultPath: `${sanitizeFileName(suggestedName)}.${ext}`,
    filters: [{ name: filterLabel, extensions: [ext] }],
  });
  if (!target) return false;
  await downloadToPath(url, target);
  return true;
}

export function downloadMp3(url: string, suggestedName: string): Promise<boolean> {
  return downloadWithDialog(url, suggestedName, "mp3", "Audio MP3");
}

export function downloadWavFile(url: string, suggestedName: string): Promise<boolean> {
  return downloadWithDialog(url, suggestedName, "wav", "Audio WAV");
}

/** Zapisuje tekst do .txt — do folderu domyślnego albo przez dialog zapisu.
 *  Zwraca ścieżkę pliku, albo null gdy użytkownik anulował dialog. */
export async function saveTextFile(
  text: string,
  suggestedName: string,
  defaultDir: string
): Promise<string | null> {
  const fileName = `${sanitizeFileName(suggestedName)}.txt`;
  const target = defaultDir
    ? `${defaultDir}/${fileName}`
    : await save({ defaultPath: fileName, filters: [{ name: "Tekst", extensions: ["txt"] }] });
  if (!target) return null;
  await writeTextFile(target, text);
  return target;
}

/** Rozszerzenie pliku obrazu z URL-a (fallback jpeg). */
export function imageExt(url: string): string {
  const match = url.split("?")[0].match(/\.(jpe?g|png|webp)$/i);
  return match ? match[1].toLowerCase() : "jpeg";
}

export function downloadImageFile(url: string, suggestedName: string): Promise<boolean> {
  return downloadWithDialog(url, suggestedName, imageExt(url), "Obraz");
}

/** Zleca konwersję utworu do WAV i polluje aż do gotowego URL-a pliku. */
export async function convertToWav(
  sunoKey: string,
  taskId: string,
  audioId: string
): Promise<string> {
  const res = await fetch(`${BASE}/wav/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sunoKey}`,
    },
    body: JSON.stringify({
      taskId,
      audioId,
      callBackUrl: "https://example.com/suno-callback",
    }),
  });
  const body: SunoEnvelope<{ taskId?: string }> = await res.json();
  let created: { taskId: string };
  if (body.code === 200 && body.data?.taskId) {
    created = { taskId: body.data.taskId };
  } else if (body.code === 409 && body.data?.taskId) {
    // konwersja już istnieje — 409 zwraca taskId istniejącego rekordu WAV
    created = { taskId: body.data.taskId };
  } else {
    throw new Error(`Suno API (${body.code}): ${body.msg ?? "nieznany błąd"}`);
  }
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await sleep(5_000);
    let info: { successFlag?: string; errorMessage?: string | null; response?: { audioWavUrl?: string } };
    try {
      info = await sunoFetch(`/wav/record-info?taskId=${encodeURIComponent(created.taskId)}`, sunoKey);
    } catch {
      continue; // chwilowy błąd sieci — próbujemy dalej
    }
    if (info.successFlag === "SUCCESS" && info.response?.audioWavUrl) {
      return info.response.audioWavUrl;
    }
    if (info.successFlag && info.successFlag !== "PENDING") {
      throw new Error(info.errorMessage || `Konwersja WAV nie powiodła się (${info.successFlag})`);
    }
  }
  throw new Error("Przekroczono czas oczekiwania na konwersję WAV");
}
