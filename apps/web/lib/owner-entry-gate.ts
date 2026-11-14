// Phase 42E activation gate for the complete owner entry: the setup guide at
// `/auth/entry`, the editor at `/editor` and the editor's iframe preview
// document at `/editor/preview`. The roadmap keeps it closed until the
// Phase 39/45 integration passes (contact delivery, Phases 43–45, does not
// exist yet). Only the exact value "active" opens it; committed configuration
// leaves it unset, so both routes keep the welcome shell.
export type OwnerEntryGate = { OWNER_ENTRY_ACTIVATION?: string | undefined };

export function ownerEntryActive(env: OwnerEntryGate) {
  return env.OWNER_ENTRY_ACTIVATION === "active";
}
