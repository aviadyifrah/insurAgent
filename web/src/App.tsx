import { useEffect, useState } from "react";
import { api } from "./api";
import type { User } from "./types";
import { Login } from "./pages/Login";
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

export function App() {
  const route = useHashRoute();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  if (route === "/legal") return <Legal />;
  if (user === undefined) return <div className="splash">טוען…</div>;
  if (user === null) return <Login onLogin={setUser} />;

  const claimMatch = route.match(/^\/claims\/(\d+)$/);
  if (claimMatch) return <ClaimPage key={claimMatch[1]} claimId={Number(claimMatch[1])} />;
  if (route === "/profile") return <Profile user={user} onChange={setUser} onLogout={() => setUser(null)} />;
  return <Home user={user} />;
}
