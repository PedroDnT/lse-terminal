// ============================================================================
// firebase.ts - local stand-in for the hosted auth SDK.
//
// The terminal has no accounts and no remote backend, so there is no Firebase
// project, no config and no network calls here. The ported chart code only ever
// reads `auth.currentUser?.uid` (to key per-user persistence and to guard
// against a save landing under the wrong account after a user switch), so a
// fixed local identity satisfies every call site.
//
// Keeping a stable uid rather than `null` is what makes persistence ACTIVE:
// the settings/layout/watchlist paths short-circuit when there is no user, so a
// null identity would silently disable saving on a single-user local app.
// ============================================================================

export const LOCAL_UID = 'local';

export const auth = {
  currentUser: { uid: LOCAL_UID } as { uid: string } | null,
};
