import { useState } from "react";
import { Music, PenLine } from "lucide-react";
import DocPicker from "../components/DocPicker";
import SongEditor, { validateDraft } from "../components/SongEditor";
import {
  LibraryDoc,
  Persona,
  PersonaModel,
  Provider,
  Settings,
  SongDraft,
  SunoModel,
} from "@suno/core";

const SUNO_MODELS: SunoModel[] = ["V4", "V4_5", "V4_5PLUS", "V4_5ALL", "V5", "V5_5"];

interface Props {
  settings: Settings;
  library: LibraryDoc[];
  personas: Persona[];
  onWriteLyrics: (params: {
    brief: string;
    useLibrary: boolean;
    excludedIds: string[];
    provider: Provider;
    sunoModel: SunoModel;
  }) => Promise<{ draft: SongDraft; usedSources: string | null }>;
  onGenerateMusic: (
    draft: SongDraft,
    sunoModel: SunoModel,
    provider: Provider,
    instrumental: boolean,
    persona?: { id: string; model: PersonaModel; name: string }
  ) => Promise<unknown>;
}

export default function CreateView({
  settings,
  library,
  personas,
  onWriteLyrics,
  onGenerateMusic,
}: Props) {
  const [brief, setBrief] = useState("");
  const [useLibrary, setUseLibrary] = useState(true);
  // Zbiór ODZNACZONYCH plików — nowe pliki są domyślnie zaznaczone
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState<Provider>(settings.provider);
  const [sunoModel, setSunoModel] = useState<SunoModel>(settings.sunoModel);
  const [instrumental, setInstrumental] = useState(false);
  const [personaId, setPersonaId] = useState("");
  const [personaModel, setPersonaModel] = useState<PersonaModel>("voice_persona");
  const [draft, setDraft] = useState<SongDraft | null>(null);
  const [usedSources, setUsedSources] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function writeLyrics() {
    setError(null);
    setInfo(null);
    setUsedSources(null);
    const selectedCount = library.filter((d) => !excludedIds.has(d.id)).length;
    if (!brief.trim() && (!useLibrary || selectedCount === 0)) {
      setError("Wpisz brief lub zaznacz pliki z biblioteki (zakładka „Pliki”)");
      return;
    }
    setWriting(true);
    try {
      const result = await onWriteLyrics({
        brief,
        useLibrary,
        excludedIds: [...excludedIds],
        provider,
        sunoModel,
      });
      setUsedSources(result.usedSources);
      setDraft(result.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWriting(false);
    }
  }

  async function generateMusic() {
    if (!draft) return;
    setError(null);
    const invalid = validateDraft(draft, sunoModel);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (!settings.sunoKey) {
      setError("Brak klucza sunoapi.org — uzupełnij w Ustawieniach");
      return;
    }
    setSending(true);
    try {
      const persona = personas.find((p) => p.id === personaId);
      await onGenerateMusic(
        draft,
        sunoModel,
        provider,
        instrumental,
        persona ? { id: persona.id, model: personaModel, name: persona.name } : undefined
      );
      setInfo("Zadanie wysłane do Suno — postęp znajdziesz w Bibliotece");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="view">
      <h2>1. Brief — o czym ma być piosenka</h2>
      <textarea
        rows={3}
        placeholder="Np. wesoła piosenka pop o przyjaźni, po polsku, żeński wokal... Brief służy też do wyszukania pasujących fragmentów w bibliotece plików."
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={useLibrary}
          onChange={(e) => setUseLibrary(e.target.checked)}
          disabled={library.length === 0}
        />
        {library.length > 0
          ? "Użyj biblioteki plików (fragmenty dobierane automatycznie do briefu)"
          : "Biblioteka plików jest pusta — dodaj pliki w zakładce „Pliki”"}
      </label>

      {useLibrary && library.length > 0 && (
        <DocPicker library={library} excludedIds={excludedIds} onChange={setExcludedIds} />
      )}

      <h2>2. Ustawienia generacji</h2>
      <div className="controls-row">
        <label>
          AI do tekstu
          <select value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            <option value="anthropic">Anthropic ({settings.anthropicModel})</option>
            <option value="openai">OpenAI ({settings.openaiModel})</option>
          </select>
        </label>
        <label>
          Model Suno
          <select value={sunoModel} onChange={(e) => setSunoModel(e.target.value as SunoModel)}>
            {SUNO_MODELS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, ".")}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={instrumental}
            onChange={(e) => setInstrumental(e.target.checked)}
          />
          Instrumental (bez wokalu)
        </label>
      </div>

      {personas.length > 0 && (
        <div className="controls-row">
          <label>
            Persona (spójny wokal/styl między utworami)
            <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
              <option value="">Brak — nowy głos</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {personaId && (
            <label>
              Co przejąć z persony
              <select
                value={personaModel}
                onChange={(e) => setPersonaModel(e.target.value as PersonaModel)}
              >
                <option value="voice_persona">Głos (voice persona)</option>
                <option value="style_persona">Styl (style persona)</option>
              </select>
            </label>
          )}
        </div>
      )}

      <button className="btn-primary" onClick={writeLyrics} disabled={writing}>
        {writing ? (
          "AI pisze tekst..."
        ) : (
          <>
            <PenLine size={16} /> Napisz tekst (AI)
          </>
        )}
      </button>

      {usedSources && <p className="hint">Użyte fragmenty z biblioteki: {usedSources}</p>}

      {draft && (
        <>
          <h2>3. Piosenka (możesz edytować)</h2>
          <SongEditor draft={draft} sunoModel={sunoModel} onChange={setDraft} />
          <button className="btn-primary" onClick={generateMusic} disabled={sending}>
            {sending ? (
              "Wysyłanie do Suno..."
            ) : (
              <>
                <Music size={16} /> Generuj muzykę
              </>
            )}
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {info && <p className="info">{info}</p>}
    </div>
  );
}
