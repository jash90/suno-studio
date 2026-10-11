import Resend from "@auth/core/providers/resend";

// Reset hasła kodem z e-maila (Resend). Działa, gdy w env Convex są AUTH_RESEND_KEY
// i (opcjonalnie) AUTH_EMAIL_FROM — bez nich UI nie pokazuje „Nie pamiętasz hasła?”.
// Wysyłka zwykłym fetch do API Resend, bez SDK.
export const ResendOTPPasswordReset = Resend({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: 15 * 60,
  async generateVerificationToken() {
    const digits = crypto.getRandomValues(new Uint32Array(8));
    return [...digits].map((n) => String(n % 10)).join("");
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    if (!provider.apiKey) throw new Error("Reset hasła nie jest skonfigurowany");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.AUTH_EMAIL_FROM ?? "Suno Studio <onboarding@resend.dev>",
        to: [email],
        subject: "Suno Studio — kod do zmiany hasła",
        text: `Twój kod do ustawienia nowego hasła: ${token}\n\nKod jest ważny 15 minut. Jeśli to nie Ty — zignoruj tę wiadomość.`,
      }),
    });
    if (!res.ok) throw new Error("Nie udało się wysłać e-maila z kodem");
  },
});
