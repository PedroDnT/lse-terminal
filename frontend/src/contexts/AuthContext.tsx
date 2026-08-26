// ============================================================================
// AuthContext.tsx - local stand-in for the hosted auth context.
//
// There are no accounts in the terminal: the app runs on the user's machine and
// their data never leaves it. Rather than strip every `useAuth()` call out of
// the ported chart components (which would mean editing a dozen files and
// drifting from the original), this exposes the same hook surface backed by a
// fixed local identity.
//
// `useOptionalAuth` exists upstream for components that mount outside the
// provider and must not crash; here both hooks are total, so it simply returns
// the same value.
// ============================================================================

import { LOCAL_UID } from '@/lib/firebase';

export interface LocalUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthValue {
  user: LocalUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

// A single frozen object so identity is stable across renders. Several ported
// hooks list `user` in effect dependency arrays; a fresh object each render
// would retrigger those effects on every render and cause refetch loops.
const LOCAL_USER: LocalUser = Object.freeze({
  uid: LOCAL_UID,
  email: null,
  displayName: null,
});

const VALUE: AuthValue = Object.freeze({
  user: LOCAL_USER,
  loading: false,
  // No-op: there is no session to end. Components that render a sign-out
  // control still call this, so it must resolve rather than throw.
  signOut: async () => {},
});

export function useAuth(): AuthValue {
  return VALUE;
}

export function useOptionalAuth(): AuthValue | null {
  return VALUE;
}

// Provider kept as a pass-through so any ported tree that wraps itself in
// <AuthProvider> still mounts unchanged.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
