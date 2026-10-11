// Convex udostępnia zmienne środowiskowe deploymentu przez process.env także w
// runtime V8 — deklarujemy tylko to, bez całych typów Node.
declare const process: { env: Record<string, string | undefined> };
