import { useState } from "react";
import { BookOpen, FileText, X } from "lucide-react";
import FileDrop from "../components/FileDrop";
import { chunkText, extractText } from "../services/files";
import { guessDocKind, LibraryDoc } from "../types";

interface Props {
  library: LibraryDoc[];
  onChange: (docs: LibraryDoc[]) => void;
}

export default function FilesView({ library, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPaths(paths: string[]) {
    setError(null);
    setBusy(true);
    const added: LibraryDoc[] = [];
    const errors: string[] = [];
    for (const path of paths) {
      if (library.some((d) => d.path === path)) continue;
      try {
        const file = await extractText(path);
        const chunks = chunkText(file.text);
        if (chunks.length === 0) {
          errors.push(`${file.name}: plik nie zawiera tekstu`);
          continue;
        }
        added.push({
          id: crypto.randomUUID(),
          name: file.name,
          path: file.path,
          chunks,
          kind: guessDocKind(file.name),
          addedAt: new Date().toISOString(),
        });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(false);
    if (errors.length) setError(errors.join("; "));
    if (added.length) onChange([...library, ...added]);
  }

  const totalChunks = library.reduce((sum, d) => sum + d.chunks.length, 0);

  return (
    <div className="view">
      <h2>Biblioteka plików</h2>
      <p className="hint">
        Pliki dodajesz raz — treść jest indeksowana lokalnie. Przy każdej generacji
        aplikacja sama dobierze fragmenty pasujące do briefu (nie wysyła całej
        biblioteki do AI). Każdy plik ma rolę: <strong>źródło</strong> (materiał na
        treść piosenki) lub <strong>poradnik</strong> (wytyczne stylu/tagów Suno dla
        AI — nie trafia do tekstu utworu). Rolę zmienisz klikając etykietę.
      </p>
      <FileDrop onPaths={(paths) => void addPaths(paths)} busy={busy} />
      {error && <p className="error">{error}</p>}
      {library.length > 0 ? (
        <>
          <p className="hint">
            {library.length} plik(ów), {totalChunks} fragmentów w indeksie
          </p>
          <ul className="filedrop-list">
            {library.map((doc) => (
              <li key={doc.id}>
                <span className="file-name" title={doc.path}>{doc.name}</span>
                <button
                  className={`badge badge-kind-${doc.kind}`}
                  title="Kliknij, aby zmienić rolę pliku"
                  onClick={() =>
                    onChange(
                      library.map((d) =>
                        d.id === doc.id
                          ? { ...d, kind: d.kind === "guide" ? "content" : "guide" }
                          : d
                      )
                    )
                  }
                >
                  {doc.kind === "guide" ? (
                    <><BookOpen size={12} /> poradnik</>
                  ) : (
                    <><FileText size={12} /> źródło</>
                  )}
                </button>
                <span className="file-chars">{doc.chunks.length} fragm.</span>
                <span className="file-chars">
                  {new Date(doc.addedAt).toLocaleDateString("pl-PL")}
                </span>
                <button
                  className="btn-icon"
                  title="Usuń z biblioteki"
                  onClick={() => onChange(library.filter((d) => d.id !== doc.id))}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="empty">Biblioteka jest pusta — dodaj pliki powyżej.</p>
      )}
    </div>
  );
}
