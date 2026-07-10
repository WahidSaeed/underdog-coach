// Fake auth - no real backend, no password, just a localStorage flag
// gating the app behind a login screen (AuthGate/LoginScreen). Good
// enough for a demo login/logout flow, not real access control.
const AUTH_KEY = "uc-auth";

export function isLoggedIn(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(AUTH_KEY) === "1";
}

export function login(): void {
  window.localStorage.setItem(AUTH_KEY, "1");
}

export function logout(): void {
  window.localStorage.removeItem(AUTH_KEY);
  window.location.reload();
}
