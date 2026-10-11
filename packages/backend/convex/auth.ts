import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTPPasswordReset } from "./lib/passwordReset";

// Logowanie hasłem (bez weryfikacji e-mail) + reset hasła kodem z e-maila (Resend,
// aktywny po ustawieniu AUTH_RESEND_KEY). OAuth (GitHub/Google) dokłada się
// kolejnymi providerami i zmiennymi środowiskowymi.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({ reset: ResendOTPPasswordReset })],
});
