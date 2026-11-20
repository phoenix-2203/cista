import { useEffect, useState } from "react";
import { currentSession, type Session } from "./api";

/** The signed-in session, kept in step across the app. */
export function useSession(): Session | null {
  const [s, setS] = useState(currentSession);
  useEffect(() => {
    const update = () => setS(currentSession());
    window.addEventListener("cista:session", update);
    return () => window.removeEventListener("cista:session", update);
  }, []);
  return s;
}
