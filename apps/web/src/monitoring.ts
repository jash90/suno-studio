import platform from "@platform";

// Monitoring błędów (Sentry) — włączany zmienną VITE_SENTRY_DSN (env buildu).
// Bez DSN-a nic się nie ładuje: SDK jest importowany dynamicznie, osobnym chunkiem.
export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  void import("@sentry/react").then((Sentry) =>
    Sentry.init({
      dsn,
      environment: `${platform.kind}-${import.meta.env.MODE}`,
      release: import.meta.env.VITE_APP_VERSION as string | undefined,
      // bez PII i bez tracingu — tylko wyjątki (domyślnie SDK nie wysyła danych osobowych)
      tracesSampleRate: 0,
    })
  );
}
