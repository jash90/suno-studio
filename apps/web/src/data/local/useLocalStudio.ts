import { useSyncExternalStore } from "react";
import type { StudioBackend } from "../types";
import type { LocalStudio } from "./LocalStudio";

/** Studio na lokalnym silniku (desktop) — stan subskrybowany jak każdy zewnętrzny store. */
export function useLocalStudio(engine: LocalStudio): StudioBackend {
  const data = useSyncExternalStore(engine.subscribe, engine.getSnapshot);
  return { data, actions: engine.actions };
}
