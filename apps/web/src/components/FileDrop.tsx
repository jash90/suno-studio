import { useRef, useState } from "react";
import { SUPPORTED_EXTENSIONS } from "../services/files";

interface Props {
  onFiles: (files: File[]) => void;
  busy?: boolean;
}

const ACCEPT = SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(",");

/** Strefa drag&drop + wybór plików — zwraca pliki, przetwarzanie robi rodzic. */
export default function FileDrop({ onFiles, busy }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) onFiles(files);
    e.target.value = ""; // pozwól dodać ten sam plik ponownie
  }

  return (
    <div
      className={`filedrop-zone ${dragOver ? "drag-over" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={handlePick}
      />
      {busy
        ? "Wczytywanie plików..."
        : "Przeciągnij pliki tutaj lub kliknij, aby wybrać (txt, md, pdf, docx)"}
    </div>
  );
}
