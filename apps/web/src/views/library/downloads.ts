import { getVariants, sanitizeFileName, Track, TrackVariant } from "@suno/core";
import platform from "@platform";
import { withBusy } from "../../platform/busy";
import type { BundleFile, BundleResult } from "../../platform/types";
import {
  activeCover,
  chosenVariants,
  coverExt,
  errorText,
  modeLabel,
  VariantMode,
  variantLetter,
  variantName,
} from "./helpers";

// Pobieranie z Biblioteki — wspólne dla web (ZIP/download przeglądarki) i desktopu
// (zapis na dysk, album do folderu). Różnice załatwia warstwa @platform.

type Report = (message: string) => void;
type ConvertToWav = (domainId: string, audioId: string) => Promise<string>;

const lyricsSeparator = "\n\n" + "—".repeat(40) + "\n\n";

function trackNumber(track: Track, fallbackIndex: number): string {
  return String((track.albumIndex ?? fallbackIndex) + 1).padStart(2, "0");
}

function bundleSummary(result: BundleResult, total: number, what: string): string {
  const where = platform.kind === "desktop" ? `→ ${result.location}` : `(ZIP „${result.location}”)`;
  return (
    `Zapisano ${what}: ${result.saved}/${total} plików ${where}` +
    (result.errors.length ? ` (błędy: ${result.errors.join("; ")})` : "")
  );
}

/** Zapis pojedynczego pliku z komunikatem; null z platformy = użytkownik anulował dialog. */
async function saveOne(
  source: { url?: string; data?: string },
  fileName: string,
  label: string,
  report: Report
) {
  try {
    const location = await platform.saveFile(source, fileName);
    if (location) {
      report(platform.kind === "desktop" ? `Zapisano ${label} → ${location}` : `Zapisano ${label}`);
    }
  } catch (e) {
    report(errorText(e));
  }
}

export function downloadMp3(track: Track, variant: TrackVariant, index: number, report: Report) {
  if (!variant.audioUrl) return Promise.resolve();
  const name = variantName(track, index);
  return saveOne({ url: variant.audioUrl }, `${sanitizeFileName(name)}.mp3`, `„${name}”`, report);
}

export async function downloadWav(
  track: Track,
  variant: TrackVariant,
  index: number,
  convert: ConvertToWav,
  report: Report
) {
  const name = variantName(track, index);
  try {
    // konwersja jest jednorazowa per wariant — serwer zapamiętuje wavUrl
    const url = variant.wavUrl ?? (await convert(track.id, variant.audioId));
    await saveOne({ url }, `${sanitizeFileName(name)}.wav`, `WAV „${name}”`, report);
  } catch (e) {
    report(errorText(e));
  }
}

export function downloadCover(
  track: Track,
  variant: TrackVariant | undefined,
  index: number,
  report: Report
) {
  const url = activeCover(track, variant);
  if (!url) return Promise.resolve();
  const name = `${sanitizeFileName(variantName(track, index))}.${coverExt(url, track)}`;
  return saveOne({ url }, name, `okładkę „${track.title}”`, report);
}

export function downloadLyrics(track: Track, report: Report) {
  return saveOne(
    { data: `${track.title}\nStyl: ${track.style}\n\n${track.lyrics}` },
    `${sanitizeFileName(track.title)}.txt`,
    `tekst „${track.title}”`,
    report
  );
}

/** Cały album wg kolejności płyty: pliki "NN - Tytuł (A).mp3/.wav"; paczka
 *  „Nazwa (A+B)” — na webie ZIP, na desktopie podfolder. */
export function downloadAlbum(
  name: string,
  list: Track[],
  format: "mp3" | "wav",
  mode: VariantMode,
  convert: ConvertToWav,
  report: Report
) {
  const done = list.filter((t) => t.status === "SUCCESS");
  if (done.length === 0) {
    report("Album nie ma jeszcze ukończonych utworów");
    return Promise.resolve();
  }
  // konwersje WAV przed zapisem też blokują auto-reload PWA
  return withBusy(async () => {
    const files: BundleFile[] = [];
    const errors: string[] = [];
    for (let i = 0; i < done.length; i++) {
      const track = done[i];
      const many = getVariants(track).length > 1;
      for (const variant of chosenVariants(track, mode)) {
        const suffix = many ? ` (${variantLetter(track, variant)})` : "";
        report(
          `Przygotowanie (${format.toUpperCase()}): ${i + 1}/${done.length} — ${track.title}${suffix}`
        );
        try {
          const url =
            format === "wav"
              ? (variant.wavUrl ?? (await convert(track.id, variant.audioId)))
              : variant.audioUrl;
          if (!url) throw new Error("brak pliku audio");
          files.push({
            url,
            name: `${trackNumber(track, i)} - ${sanitizeFileName(track.title)}${suffix}.${format}`,
          });
        } catch (e) {
          errors.push(`${track.title}${suffix}: ${errorText(e)}`);
        }
      }
    }
    const result = await platform.saveBundle(
      files,
      `${sanitizeFileName(name)} (${modeLabel(mode)})`,
      (d, t) => report(`Zapisywanie (${format.toUpperCase()}): ${d}/${t}`)
    );
    if (!result.location) return report("Anulowano zapis albumu");
    report(
      bundleSummary(
        { ...result, errors: [...errors, ...result.errors] },
        files.length + errors.length,
        `album „${name}” (${format.toUpperCase()})`
      )
    );
  });
}

/** Okładki wszystkich utworów albumu; jedna wspólna okładka → pojedynczy plik. */
export async function downloadAlbumCovers(
  name: string,
  list: Track[],
  selectedVariant: (track: Track) => TrackVariant | undefined,
  report: Report
) {
  const withCovers = list
    .map((t, i) => ({ track: t, order: i, imageUrl: activeCover(t, selectedVariant(t)) }))
    .filter((x): x is typeof x & { imageUrl: string } => !!x.imageUrl);
  if (withCovers.length === 0) return report("Album nie ma jeszcze okładek");
  const unique = withCovers.filter(
    (x, i) => withCovers.findIndex((y) => y.imageUrl === x.imageUrl) === i
  );
  if (unique.length === 1) {
    const { track, imageUrl } = unique[0];
    return saveOne(
      { url: imageUrl },
      `${sanitizeFileName(name)} - okładka.${coverExt(imageUrl, track)}`,
      `okładkę albumu „${name}”`,
      report
    );
  }
  try {
    const result = await platform.saveBundle(
      unique.map(({ track, order, imageUrl }) => ({
        url: imageUrl,
        name: `${trackNumber(track, order)} - ${sanitizeFileName(track.title)}.${coverExt(imageUrl, track)}`,
      })),
      `${sanitizeFileName(name)} - okładki`,
      (d, t) => report(`Zapisywanie okładek: ${d}/${t}`)
    );
    if (result.location) report(bundleSummary(result, unique.length, `okładki albumu „${name}”`));
  } catch (e) {
    report(errorText(e));
  }
}

/** Teksty wszystkich piosenek albumu w jednym pliku .txt. */
export function downloadAlbumLyrics(name: string, list: Track[], report: Report) {
  const withLyrics = list.filter((t) => t.lyrics);
  if (withLyrics.length === 0) {
    report("Album nie ma jeszcze tekstów");
    return Promise.resolve();
  }
  const body = withLyrics
    .map((t, i) => `${trackNumber(t, i)}. ${t.title}\nStyl: ${t.style}\n\n${t.lyrics}`)
    .join(lyricsSeparator);
  return saveOne(
    { data: `${name}${lyricsSeparator}${body}` },
    `${sanitizeFileName(name)} - teksty.txt`,
    `teksty albumu „${name}” (${withLyrics.length})`,
    report
  );
}
