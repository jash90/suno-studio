import { FormEvent, useState } from "react";
import { Headphones } from "lucide-react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@suno/backend/api";

type Flow = "signIn" | "signUp" | "reset" | "reset-verification";

const HINTS: Record<Flow, string> = {
  signIn: "Zaloguj się — dane i klucze API zapisują się na Twoim koncie.",
  signUp: "Załóż konto — dane i klucze API zapisują się na Twoim koncie.",
  reset: "Podaj e-mail konta — wyślemy kod do ustawienia nowego hasła.",
  "reset-verification": "Wpisz kod z e-maila i nowe hasło.",
};

const SUBMIT: Record<Flow, string> = {
  signIn: "Zaloguj",
  signUp: "Zarejestruj",
  reset: "Wyślij kod",
  "reset-verification": "Ustaw hasło i zaloguj",
};

export default function SignIn() {
  const { signIn } = useAuthActions();
  // reset hasła pokazujemy tylko, gdy backend ma skonfigurowaną wysyłkę e-maili
  const resetAvailable = useQuery(api.account.passwordResetAvailable) ?? false;
  const [flow, setFlow] = useState<Flow>("signIn");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const formData = new FormData(event.currentTarget);
    formData.set("flow", flow);
    formData.set("email", email);
    void signIn("password", formData)
      .then(() => {
        if (flow === "reset") setFlow("reset-verification");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }

  const passwordField =
    flow === "reset" ? null : (
      <input
        key={flow}
        name={flow === "reset-verification" ? "newPassword" : "password"}
        type="password"
        placeholder={flow === "reset-verification" ? "Nowe hasło" : "Hasło"}
        required
        minLength={flow === "signIn" ? undefined : 8}
        autoComplete={flow === "signIn" ? "current-password" : "new-password"}
      />
    );

  return (
    <div className="app-loading">
      <form className="signin" onSubmit={submit}>
        <h1>
          <Headphones size={20} /> Suno Studio
        </h1>
        <p className="hint">{HINTS[flow]}</p>
        <input
          name="email"
          type="email"
          placeholder="E-mail"
          required
          autoComplete="email"
          value={email}
          readOnly={flow === "reset-verification"}
          onChange={(e) => setEmail(e.target.value)}
        />
        {flow === "reset-verification" && (
          <input
            name="code"
            placeholder="Kod z e-maila"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
          />
        )}
        {passwordField}
        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? "..." : SUBMIT[flow]}
        </button>
        {flow === "signIn" || flow === "signUp" ? (
          <button
            type="button"
            className="btn-link"
            onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
          >
            {flow === "signIn" ? "Nie masz konta? Zarejestruj się" : "Masz konto? Zaloguj się"}
          </button>
        ) : (
          <button type="button" className="btn-link" onClick={() => setFlow("signIn")}>
            Wróć do logowania
          </button>
        )}
        {flow === "signIn" && resetAvailable && (
          <button type="button" className="btn-link" onClick={() => setFlow("reset")}>
            Nie pamiętasz hasła?
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  );
}
