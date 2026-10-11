import { SongDraft, SUNO_LIMITS, SunoModel } from "../types";

interface Props {
  draft: SongDraft;
  sunoModel: SunoModel;
  onChange: (draft: SongDraft) => void;
}

function Counter({ value, limit }: { value: number; limit: number }) {
  return (
    <span className={`counter ${value > limit ? "over" : ""}`}>
      {value.toLocaleString("pl-PL")} / {limit.toLocaleString("pl-PL")}
    </span>
  );
}

export default function SongEditor({ draft, sunoModel, onChange }: Props) {
  const limits = SUNO_LIMITS[sunoModel];
  return (
    <div className="song-editor">
      <label>
        <div className="label-row">
          <span>Tytuł</span>
          <Counter value={draft.title.length} limit={limits.title} />
        </div>
        <input
          value={draft.title}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
      </label>
      <label>
        <div className="label-row">
          <span>Styl (po angielsku)</span>
          <Counter value={draft.style.length} limit={limits.style} />
        </div>
        <textarea
          rows={3}
          value={draft.style}
          onChange={(e) => onChange({ ...draft, style: e.target.value })}
        />
      </label>
      <label>
        <div className="label-row">
          <span>Tekst piosenki</span>
          <Counter value={draft.lyrics.length} limit={limits.lyrics} />
        </div>
        <textarea
          rows={14}
          value={draft.lyrics}
          onChange={(e) => onChange({ ...draft, lyrics: e.target.value })}
        />
      </label>
    </div>
  );
}

export function validateDraft(draft: SongDraft, sunoModel: SunoModel): string | null {
  const limits = SUNO_LIMITS[sunoModel];
  if (!draft.title.trim()) return "Tytuł nie może być pusty";
  if (!draft.style.trim()) return "Styl nie może być pusty";
  if (draft.title.length > limits.title)
    return `Tytuł przekracza limit ${limits.title} znaków dla modelu ${sunoModel}`;
  if (draft.style.length > limits.style)
    return `Styl przekracza limit ${limits.style} znaków dla modelu ${sunoModel}`;
  if (draft.lyrics.length > limits.lyrics)
    return `Tekst przekracza limit ${limits.lyrics} znaków dla modelu ${sunoModel}`;
  return null;
}
