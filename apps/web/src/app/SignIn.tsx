import { FormEvent, useState } from "react";
import { Headphones } from "lucide-react";
import { useAuthActions } from "@convex-dev/auth/react";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const formData = new FormData(event.currentTarget);
    formData.set("flow", flow);
    void signIn("password", formData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }

  return (
    <div className="app-loading">
      <form className="signin" onSubmit={submit}>
        <h1>
          <Headphones size={20} /> Suno Studio
        </h1>
        <p className="hint">
          {flow === "signIn" ? "Zaloguj się" : "Załóż konto"} — dane i klucze API zapisują się na
          Twoim koncie.
        </p>
        <input name="email" type="email" placeholder="E-mail" required autoComplete="email" />
        <input
          name="password"
          type="password"
          placeholder="Hasło"
          required
          autoComplete={flow === "signIn" ? "current-password" : "new-password"}
        />
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "..." : flow === "signIn" ? "Zaloguj" : "Zarejestruj"}
        </button>
        <button
          type="button"
          className="btn-link"
          onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
        >
          {flow === "signIn" ? "Nie masz konta? Zarejestruj się" : "Masz konto? Zaloguj się"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
