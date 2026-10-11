import { useEffect } from "react";
import { Authenticated, AuthLoading, ConvexReactClient, Unauthenticated } from "convex/react";
import { ConvexAuthProvider, useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { BrowserRouter } from "react-router-dom";
import platform from "@platform";
import SignIn from "../app/SignIn";
import Studio from "../app/Studio";
import AccountPanel from "../components/AccountPanel";
import { useConvexStudio } from "../data/convex";

// Wersja web: konto (Convex Auth), dane w Convex, PWA.

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function WebStudio() {
  const backend = useConvexStudio();
  const { signOut } = useAuthActions();
  // Proxy /download wymaga tokenu — przekazujemy aktualny do warstwy platformy
  const authToken = useAuthToken();
  useEffect(() => platform.setAuthToken(authToken ?? null), [authToken]);
  return (
    <Studio backend={backend} settingsExtras={<AccountPanel />} onSignOut={() => void signOut()} />
  );
}

export default function Root() {
  return (
    <ConvexAuthProvider client={convex}>
      <BrowserRouter>
        <AuthLoading>
          <div className="app-loading">Wczytywanie...</div>
        </AuthLoading>
        <Unauthenticated>
          <SignIn />
        </Unauthenticated>
        <Authenticated>
          <WebStudio />
        </Authenticated>
      </BrowserRouter>
    </ConvexAuthProvider>
  );
}
