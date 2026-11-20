import type { SessionIdentity } from "./repositories";

// The sign-in providers (Phase 47). Each is a Better Auth `account` row. An
// account row for one of these providers is a usable sign-in method: signing
// in finds it by provider identity, never by email.
export const SIGN_IN_PROVIDERS = ["github", "google"] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

const providerList = SIGN_IN_PROVIDERS.map((provider) => `'${provider}'`).join(
  ",",
);
// The caller's session is live and the owner is not being deleted.
const liveOwner = `EXISTS(SELECT 1 FROM session s JOIN user u ON u.id=s.user_id
  WHERE s.id=? AND u.id=? AND s.expires_at>? AND u.deleting_at IS NULL)`;

export type ProviderRemoval = "removed" | "not_connected" | "last_method";

/**
 * The signed-in owner's sign-in providers. Reads and removal recheck the
 * persisted session, so a revoked session or deleting owner sees nothing.
 * Removal never touches GitHub activity rows: the route withdraws private
 * activity through the Phase 41 path before calling `remove`.
 */
export function ownerSignInProviders(
  db: D1Database,
  identity: SessionIdentity,
) {
  const userId = identity.user.id;
  const live = () => [identity.session.id, userId, Date.now()];
  async function connected(): Promise<SignInProvider[]> {
    const { results } = await db
      .prepare(
        `SELECT DISTINCT provider_id FROM account
        WHERE user_id=? AND provider_id IN (${providerList}) AND ${liveOwner}`,
      )
      .bind(userId, ...live())
      .all<{ provider_id: string }>();
    return SIGN_IN_PROVIDERS.filter((provider) =>
      results.some((row) => row.provider_id === provider),
    );
  }
  return {
    connected,
    /**
     * Removes one provider only while another sign-in provider remains, and
     * records the disconnect. The check and the delete are one statement, so
     * concurrent removals in two tabs cannot leave the owner without a way
     * to sign in.
     */
    async remove(provider: SignInProvider): Promise<ProviderRemoval> {
      const [result] = await db.batch([
        db
          .prepare(
            `DELETE FROM account WHERE user_id=? AND provider_id=? AND ${liveOwner}
          AND EXISTS(SELECT 1 FROM account other WHERE other.user_id=account.user_id
            AND other.provider_id IN (${providerList}) AND other.provider_id<>account.provider_id)`,
          )
          .bind(userId, provider, ...live()),
        // Same transaction: only a removal records the disconnect, so signing
        // in with that provider no longer links it back by matching email.
        db
          .prepare(
            `INSERT INTO disconnected_provider(user_id,provider_id,created_at)
            SELECT ?,?,? WHERE changes()>0
            ON CONFLICT(user_id,provider_id) DO UPDATE SET created_at=excluded.created_at`,
          )
          .bind(userId, provider, Date.now()),
      ]);
      if (!result) throw new Error("Provider removal returned no result");
      if (result.meta.changes > 0) return "removed";
      return (await connected()).includes(provider)
        ? "last_method"
        : "not_connected";
    },
  };
}
