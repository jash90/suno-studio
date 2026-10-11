export type View = "create" | "album" | "files" | "library" | "player" | "settings";

export const VIEW_PATHS: Record<View, string> = {
  create: "/tworz",
  album: "/album",
  files: "/pliki",
  library: "/biblioteka",
  player: "/odtwarzacz",
  settings: "/ustawienia",
};

export function pathToView(pathname: string): View | null {
  const hit = (Object.entries(VIEW_PATHS) as [View, string][]).find(
    ([, path]) => path === pathname
  );
  return hit ? hit[0] : null;
}
