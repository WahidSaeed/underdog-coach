"use client";

import { useEffect, useState } from "react";
import LoginScreen from "./LoginScreen";
import { isLoggedIn, login } from "@/lib/auth";

// Gates the whole app (wrapped around {children} in app/layout.tsx)
// behind the fake login screen - checked is a separate flag from
// loggedIn so the real page never flashes before the localStorage read
// resolves on mount (SSR has no localStorage, so the initial render
// can't know the answer yet).
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [loggedIn, setLoggedIn] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
    setChecked(true);
  }, []);

  if (!checked) return null;

  if (!loggedIn) {
    return (
      <LoginScreen
        onLogin={() => {
          login();
          setLoggedIn(true);
        }}
      />
    );
  }

  return <>{children}</>;
}
