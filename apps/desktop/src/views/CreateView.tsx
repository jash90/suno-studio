import { useState } from "react";
import { BookOpen, FileText, Music, PenLine } from "lucide-react";
import SongEditor, { validateDraft } from "../components/SongEditor";
import { generateSong } from "../services/llm";
import { buildContext, retrieveChunks, summarizeSources } from "../services/rag";
import {
  LibraryDoc,
  Persona,
  PersonaModel,
  Provider,
  Settings,
  SongDraft,
  SunoModel,
} from "../types";

const SUNO_MODELS: SunoModel[] = ["V4", "V4_5", "V4_5PLUS", "V4_5ALL", "V5", "V5_5"];

interface Props {
  settings: Settings;
  library: LibraryDoc[];
  personas: Persona[];
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
      let context = "";
      let guides = "";
      const activeDocs = library.filter((d) => !excludedIds.has(d.id));
      if (useLibrary && activeDocs.length > 0) {
        const contentDocs = activeDocs.filter((d) => d.kind !== "guide");
        const guideDocs = activeDocs.filter((d) => d.kind === "guide");
        const chunks = retrieveChunks(contentDocs, brief);
        context = buildContext(chunks);
        // Poradniki: zapytanie ukierunkowane na tagi/styl/strukturę Suno
        const guideChunks = retrieveChunks(
          guideDocs,
          `${brief} styl gatunek tagi suno struktura piosenki style tags vocal ` +
            `ambience intro outro chorus verse bridge instrumental meta tags`,
          6
        );
        guides = buildContext(guideChunks);
        const parts = [
          chunks.length > 0 ? `źródła: ${summarizeSources(chunks)}` : null,
          guideChunks.length > 0 ? `poradniki: ${summarizeSources(guideChunks)}` : null,
        ].filter(Boolean);
        setUsedSources(parts.length > 0 ? parts.join(" | ") : null);
      }
      setDraft(
        await generateSong(provider, settings, context, guides, brief, sunoModel)
      );
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
          ? `Użyj biblioteki plików (zaznaczono ${library.length - excludedIds.size} z ${library.length} — fragmenty dobierane automatycznie do briefu)`
          : "Biblioteka plików jest pusta — dodaj pliki w zakładce „Pliki”"}
      </label>

      {useLibrary && library.length > 0 && (
        <div className="doc-picker">
          <div className="doc-picker-actions">
            <button className="btn-link" onClick={() => setExcludedIds(new Set())}>
              zaznacz wszystkie
            </button>
            <button
              className="btn-link"
              onClick={() => setExcludedIds(new Set(library.map((d) => d.id)))}
            >
              odznacz wszystkie
            </button>
          </div>
          <ul className="doc-picker-list">
            {library.map((doc) => (
              <li key={doc.id}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={!excludedIds.has(doc.id)}
                    onChange={(e) => {
                      const next = new Set(excludedIds);
                      if (e.target.checked) next.delete(doc.id);
                      else next.add(doc.id);
                      setExcludedIds(next);
                    }}
                  />
                  {doc.kind === "guide" ? (
                    <BookOpen size={13} className="kind-guide" />
                  ) : (
                    <FileText size={13} className="kind-content" />
                  )}
                  <span className="file-name">{doc.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
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
              <option key={m} value={m}>{m.replace(/_/g, ".")}</option>
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
                <option key={p.id} value={p.id}>{p.name}</option>
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
        {writing ? "AI pisze tekst..." : <><PenLine size={16} /> Napisz tekst (AI)</>}
      </button>

      {usedSources && (
        <p className="hint">Użyte fragmenty z biblioteki: {usedSources}</p>
      )}

      {draft && (
        <>
          <h2>3. Piosenka (możesz edytować)</h2>
          <SongEditor draft={draft} sunoModel={sunoModel} onChange={setDraft} />
          <button className="btn-primary" onClick={generateMusic} disabled={sending}>
            {sending ? "Wysyłanie do Suno..." : <><Music size={16} /> Generuj muzykę</>}
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {info && <p className="info">{info}</p>}
    </div>
  );
}
