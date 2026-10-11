import { useRef } from "react";

/** Trzyma ostatnią znaną wartość kwerendy. Przy reconnect'cie Convexa (deploy
 *  funkcji, odświeżenie tokenu, zanik sieci) useQuery chwilowo zwraca undefined —
 *  bez latcha cały interfejs przeskakiwał na „Wczytywanie..." i montował się od
 *  nowa (wszystko "skakało"). Z latchem pełny ekran ładowania jest tylko raz. */
export function useLatest<T>(value: T | undefined): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (value !== undefined) ref.current = value;
  return ref.current;
}
