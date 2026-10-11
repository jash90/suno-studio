import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import SignIn from "./app/SignIn";
import Studio from "./app/Studio";

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="app-loading">Wczytywanie...</div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Studio />
      </Authenticated>
    </>
  );
}
