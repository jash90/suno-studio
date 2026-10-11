import { useState } from "react";
import { BookOpen, FileText, X } from "lucide-react";
import FileDrop from "../components/FileDrop";
import { chunkText, extractText } from "../services/files";
import { guessDocKind, LibraryDoc } from "@suno/core";

interface Props {
  library: LibraryDoc[];
  onAdd: (docs: LibraryDoc[]) => void;
  onToggleKind: (id: string) => void;
  onRemove: (id: string) => void;
}

export default function FilesView({ library, onAdd, onToggleKind, onRemove }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    setError(null);
    setBusy(true);
    const added: LibraryDoc[] = [];
    const errors: string[] = [];
    for (const file of files) {
      if (library.some((d) => d.path === file.name)) continue;
      try {
        const source = await extractText(file);
        const chunks = chunkText(source.text);
        if (chunks.length === 0) {
          errors.push(`${source.name}: plik nie zawiera tekstu`);
          continue;
        }
        added.push({
          id: crypto.randomUUID(),
          name: source.name,
          path: source.path,
          chunks,
          kind: guessDocKind(source.name),
          addedAt: new Date().toISOString(),
        });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(false);
    if (errors.length) setError(errors.join("; "));
    if (added.length) onAdd(added);
  }

  const totalChunks = library.reduce((sum, d) => sum + d.chunks.length, 0);

  return (
    <div className="view">
      <h2>Biblioteka plików</h2>
      <p className="hint">
        Pliki dodajesz raz — treść jest indeksowana. Przy każdej generacji aplikacja sama dobierze
        fragmenty pasujące do briefu (nie wysyła całej biblioteki do AI). Każdy plik ma rolę:{" "}
        <strong>źródło</strong> (materiał na treść piosenki) lub <strong>poradnik</strong> (wytyczne
        stylu/tagów Suno dla AI — nie trafia do tekstu utworu). Rolę zmienisz klikając etykietę.
      </p>
      <FileDrop onFiles={(files) => void addFiles(files)} busy={busy} />
      {error && <p className="error">{error}</p>}
      {library.length > 0 ? (
        <>
          <p className="hint">
            {library.length} plik(ów), {totalChunks} fragmentów w indeksie
          </p>
          <ul className="filedrop-list">
            {library.map((doc) => (
              <li key={doc.id}>
                <span className="file-name" title={doc.path}>
                  {doc.name}
                </span>
                <button
                  className={`badge badge-kind-${doc.kind}`}
                  title="Kliknij, aby zmienić rolę pliku"
                  onClick={() => onToggleKind(doc.id)}
                >
                  {doc.kind === "guide" ? (
                    <>
                      <BookOpen size={12} /> poradnik
                    </>
                  ) : (
                    <>
                      <FileText size={12} /> źródło
                    </>
                  )}
                </button>
                <span className="file-chars">{doc.chunks.length} fragm.</span>
                <span className="file-chars">
                  {new Date(doc.addedAt).toLocaleDateString("pl-PL")}
                </span>
                <button
                  className="btn-icon"
                  title="Usuń z biblioteki"
                  onClick={() => onRemove(doc.id)}
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
