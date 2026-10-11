// Licznik długich operacji (pobierania/ZIP/konwersje) — auto-aktualizacja PWA czeka,
// aż aplikacja będzie bezczynna, żeby reload nie przerywał pobierania.
let busyCount = 0;
const idleWaiters: (() => void)[] = [];

export function beginBusy(): void {
  busyCount++;
}

export function endBusy(): void {
  busyCount = Math.max(0, busyCount - 1);
  if (busyCount === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
}

export function whenIdle(): Promise<void> {
  return busyCount === 0 ? Promise.resolve() : new Promise((r) => idleWaiters.push(r));
}

export async function withBusy<T>(work: () => Promise<T>): Promise<T> {
  beginBusy();
  try {
    return await work();
  } finally {
    endBusy();
  }
}
