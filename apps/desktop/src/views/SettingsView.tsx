import { useState } from "react";
import { Check, Eye, EyeOff, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCredits } from "../services/suno";
import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  Provider,
  Settings,
  SunoModel,
} from "../types";
import { ALBUM_PROMPT_TEMPLATE, SONG_PROMPT_TEMPLATE } from "../prompts";

/** Edytor promptu systemowego: puste pole = wbudowany szablon. */
function PromptEditor({
  label,
  value,
  defaultTemplate,
  onChange,
}: {
  label: string;
  value: string;
  defaultTemplate: string;
  onChange: (v: string) => void;
}) {
  const isCustom = value.trim() !== "";
  return (
    <label>
      <span className="label-row">
        {label}
        <span className="counter">{isCustom ? "własny" : "wbudowany"}</span>
      </span>
      <textarea
        rows={10}
        value={value}
        placeholder='Używany jest wbudowany prompt — kliknij „Wstaw wbudowany do edycji", aby go zmienić'
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="doc-picker-actions">
        <button type="button" className="btn-link" onClick={() => onChange(defaultTemplate)}>
          Wstaw wbudowany do edycji
        </button>
        {isCustom && (
          <button type="button" className="btn-link" onClick={() => onChange("")}>
            Przywróć wbudowany
          </button>
        )}
      </span>
    </label>
  );
}

/** Select z listą modeli; zachowuje bieżącą wartość spoza listy jako dodatkową opcję. */
function ModelSelect({
  value,
  models,
  onChange,
}: {
  value: string;
  models: readonly string[];
  onChange: (v: string) => void;
}) {
  const options = models.includes(value) ? models : [value, ...models];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}

interface Props {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
}

function KeyInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <div className="key-row">
        <input
          type={visible ? "text" : "password"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
        <button
          className="btn-icon"
          type="button"
          title={visible ? "Ukryj klucz" : "Pokaż klucz"}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
}

export default function SettingsView({ settings, onSave }: Props) {
  const [form, setForm] = useState<Settings>(settings);
  const [saved, setSaved] = useState(false);
  const [credits, setCredits] = useState<string | null>(null);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm({ ...form, [key]: value });
    setSaved(false);
  }

  async function handleSave() {
    await onSave(form);
    setSaved(true);
  }

  async function checkCredits() {
    setCredits(null);
    try {
      const value = await getCredits(form.sunoKey);
      setCredits(`Pozostałe kredyty Suno: ${value}`);
    } catch (e) {
      setCredits(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="view settings">
      <h2>Klucze API</h2>
      <KeyInput
        label="Klucz sunoapi.org"
        value={form.sunoKey}
        placeholder="Klucz z panelu api.sunoapi.org"
        onChange={(v) => set("sunoKey", v)}
      />
      <KeyInput
        label="Klucz Anthropic"
        value={form.anthropicKey}
        placeholder="sk-ant-..."
        onChange={(v) => set("anthropicKey", v)}
      />
      <KeyInput
        label="Klucz OpenAI"
        value={form.openaiKey}
        placeholder="sk-..."
        onChange={(v) => set("openaiKey", v)}
      />

      <h2>Salda na górnym pasku</h2>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.showBalances}
          onChange={(e) => set("showBalances", e.target.checked)}
        />
        Pokazuj kredyty Suno i wydatki AI obok logo
      </label>
      <p className="hint">
        Kredyty Suno działają od razu. Wydatki Anthropic/OpenAI wymagają osobnych
        kluczy administracyjnych (zwykłe klucze API nie mają dostępu do rozliczeń) —
        pokazywana jest suma wydatków w bieżącym miesiącu.
      </p>
      <KeyInput
        label="Klucz Anthropic Admin (opcjonalny)"
        value={form.anthropicAdminKey}
        placeholder="sk-ant-admin..."
        onChange={(v) => set("anthropicAdminKey", v)}
      />
      <KeyInput
        label="Klucz OpenAI Admin (opcjonalny, uprawnienie api.usage.read)"
        value={form.openaiAdminKey}
        placeholder="sk-admin-..."
        onChange={(v) => set("openaiAdminKey", v)}
      />

      <h2>Folder zapisu</h2>
      <p className="hint">
        Domyślny folder na pobierane albumy i pliki. Gdy ustawiony, pobieranie nie
        pyta o lokalizację — od razu tworzy podfolder albumu. Puste = pytaj za każdym razem.
      </p>
      <div className="key-row">
        <input
          type="text"
          value={form.defaultSaveDir}
          placeholder="Nie ustawiono — będzie pytać przy pobieraniu"
          onChange={(e) => set("defaultSaveDir", e.target.value)}
        />
        <button
          className="btn-icon"
          type="button"
          title="Wybierz folder"
          onClick={async () => {
            const dir = await open({ directory: true, title: "Domyślny folder zapisu" });
            if (typeof dir === "string") set("defaultSaveDir", dir);
          }}
        >
          <FolderOpen size={16} />
        </button>
        {form.defaultSaveDir && (
          <button type="button" onClick={() => set("defaultSaveDir", "")}>
            Wyczyść
          </button>
        )}
      </div>

      <h2>Prompty systemowe</h2>
      <p className="hint">
        Instrukcje dla AI piszącego teksty i planującego album. Puste pole = prompt
        wbudowany. Brief i poradniki z biblioteki doklejają się automatycznie.
      </p>
      <PromptEditor
        label="Prompt piosenki"
        value={form.songSystemPrompt}
        defaultTemplate={SONG_PROMPT_TEMPLATE}
        onChange={(v) => set("songSystemPrompt", v)}
      />
      <PromptEditor
        label="Prompt albumu"
        value={form.albumSystemPrompt}
        defaultTemplate={ALBUM_PROMPT_TEMPLATE}
        onChange={(v) => set("albumSystemPrompt", v)}
      />

      <h2>Domyślne ustawienia</h2>
      <div className="controls-row">
        <label>
          Domyślne AI
          <select
            value={form.provider}
            onChange={(e) => set("provider", e.target.value as Provider)}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label>
          Model Anthropic
          <ModelSelect
            value={form.anthropicModel}
            models={ANTHROPIC_MODELS}
            onChange={(v) => set("anthropicModel", v)}
          />
        </label>
        <label>
          Model OpenAI
          <ModelSelect
            value={form.openaiModel}
            models={OPENAI_MODELS}
            onChange={(v) => set("openaiModel", v)}
          />
        </label>
        <label>
          Domyślny model Suno
          <select
            value={form.sunoModel}
            onChange={(e) => set("sunoModel", e.target.value as SunoModel)}
          >
            {(["V4", "V4_5", "V4_5PLUS", "V4_5ALL", "V5", "V5_5"] as SunoModel[]).map((m) => (
              <option key={m} value={m}>{m.replace(/_/g, ".")}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="controls-row">
        <button className="btn-primary" onClick={handleSave}>
          Zapisz ustawienia
        </button>
        <button onClick={checkCredits} disabled={!form.sunoKey}>
          Sprawdź kredyty Suno
        </button>
      </div>
      {saved && <p className="info"><Check size={14} /> Zapisano</p>}
      {credits && <p className="info">{credits}</p>}
    </div>
  );
}
