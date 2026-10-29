import { useEffect, useState } from "react";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { api, ApiError } from "./api";
import { auth } from "./firebase";
import type { User } from "./types";
import { Login } from "./pages/Login";
import { Consent } from "./pages/Consent";
import { Home } from "./pages/Home";
import { ClaimPage } from "./pages/ClaimPage";
import { Profile } from "./pages/Profile";
import { Legal } from "./pages/Legal";

export function navigate(path: string) {
  window.location.hash = path;
}

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

type Session =
  | { state: "loading" }
  | { state: "signed_out" }
  | { state: "needs_consent"; firebaseUser: FirebaseUser }
  | { state: "ready"; user: User };

export function App() {
  const route = useHashRoute();
  const [session, setSession] = useState<Session>({ state: "loading" });

  useEffect(
    () =>
      onAuthStateChanged(auth, async (firebaseUser) => {
        if (!firebaseUser) return setSession({ state: "signed_out" });
        try {
          setSession({ state: "ready", user: await api.me() });
        } catch (err) {
          if (err instanceof ApiError && err.message === "consent_required") setSession({ state: "needs_consent", firebaseUser });
          else setSession({ state: "signed_out" });
        }
      }),
    [],
  );

  if (route === "/legal") return <Legal />;
  if (session.state === "loading") return <div className="splash">טוען…</div>;
  if (session.state === "signed_out") return <Login />;
  if (session.state === "needs_consent")
    return <Consent email={session.firebaseUser.email ?? ""} onDone={(user) => setSession({ state: "ready", user })} />;

  const { user } = session;
  const claimMatch = route.match(/^\/claims\/([\w-]+)$/);
  if (claimMatch) return <ClaimPage key={claimMatch[1]} claimId={claimMatch[1]} user={user} />;
  if (route === "/profile") return <Profile user={user} onChange={(u) => setSession({ state: "ready", user: u })} />;
  return <Home user={user} />;
}
