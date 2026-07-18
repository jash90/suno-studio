import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { SUPPORTED_EXTENSIONS } from "../services/files";

interface Props {
  onPaths: (paths: string[]) => void;
  busy?: boolean;
}

/** Strefa drag&drop + wybór plików — zwraca ścieżki, przetwarzanie robi rodzic. */
export default function FileDrop({ onPaths, busy }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const onPathsRef = useRef(onPaths);
  onPathsRef.current = onPaths;

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "over") setDragOver(true);
      else if (event.payload.type === "leave") setDragOver(false);
      else if (event.payload.type === "drop") {
        setDragOver(false);
        onPathsRef.current(event.payload.paths);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  async function pickFiles() {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Dokumenty", extensions: SUPPORTED_EXTENSIONS }],
    });
    if (picked) onPaths(Array.isArray(picked) ? picked : [picked]);
  }

  return (
    <div
      className={`filedrop-zone ${dragOver ? "drag-over" : ""}`}
      onClick={pickFiles}
    >
      {busy
        ? "Wczytywanie plików..."
        : "Przeciągnij pliki tutaj lub kliknij, aby wybrać (txt, md, pdf, docx)"}
    </div>
  );
}
