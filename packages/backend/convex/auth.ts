import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// Domyślnie logowanie hasłem (bez weryfikacji e-mail). OAuth (GitHub/Google) dokłada
// się dodając kolejne providery i zmienne środowiskowe.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
