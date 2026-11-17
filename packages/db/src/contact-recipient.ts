import {
  type EmailProvider,
  validAddress,
  verificationEmail,
  verificationUrl,
} from "@hasaweb/email";
import { reserveDispatch, reserveEmail } from "./email-budget";
import { OwnerAccessError, type SessionIdentity } from "./repositories";

// The contact form's private recipient (Phase 43). One row per portfolio in
// `contact_recipient`. The account's provider-verified email is verified
// already; any other address must be confirmed through a link sent to it.
// Changing the address clears verification, which blocks form publication
// (and, from Phase 44, new submissions) until the new address is confirmed.
// The address never enters drafts, publication facts or public output.

export const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_EMAIL_BYTES = 254;

export type RecipientState = "verified" | "pending" | "unverified";
export type RecipientStatus = {
  recipient: null | { email: string; state: RecipientState };
  // The account email, when the provider verified it and it is usable.
  accountEmail: string | null;
};
export type RecipientFailure =
  | "invalid_email"
  | "account_email_unverified"
  | "limited"
  | "unavailable"
  | "delivery_failed"
  | "invalid_token"
  | "expired_token";
export type RecipientResult =
  | { ok: true; status: RecipientStatus }
  | { ok: false; error: RecipientFailure; status: RecipientStatus };

export type RecipientEnvironment = {
  // Null when this deployment cannot send email.
  provider: EmailProvider | null;
  appOrigin: string;
  now?: () => number;
};

/** A usable recipient address, or null. Never trims silently beyond spaces. */
export function recipientAddress(value: string): string | null {
  const email = value.trim();
  return email.length > 0 &&
    new TextEncoder().encode(email).byteLength <= MAX_EMAIL_BYTES &&
    ![...email].some(
      (c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f,
    ) &&
    validAddress(email)
    ? email
    : null;
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type OwnerRow = {
  portfolio_id: string;
  account_email: string;
  account_verified: number;
  email: string | null;
  verified_at: number | null;
  pending_token_hash: string | null;
  token_expires_at: number | null;
};

export function ownerContactRecipient(
  db: D1Database,
  identity: SessionIdentity,
  env: RecipientEnvironment,
) {
  const now = env.now ?? Date.now;
  // The owner's portfolio under a live, unexpired, undeleted session.
  const owned = `SELECT p.id FROM portfolio p JOIN user u ON u.id=p.user_id JOIN session s ON s.user_id=u.id
    WHERE u.id=? AND s.id=? AND s.expires_at>? AND u.deleting_at IS NULL`;
  const ownedValues = () => [identity.user.id, identity.session.id, now()];

  async function read(): Promise<OwnerRow> {
    const row = await db
      .prepare(
        `SELECT p.id AS portfolio_id,u.email AS account_email,u.email_verified AS account_verified,
          r.email,r.verified_at,r.pending_token_hash,r.token_expires_at
        FROM portfolio p JOIN user u ON u.id=p.user_id
        LEFT JOIN contact_recipient r ON r.portfolio_id=p.id
        WHERE p.id=(${owned})`,
      )
      .bind(...ownedValues())
      .first<OwnerRow>();
    if (!row) throw new OwnerAccessError();
    return row;
  }
  function project(row: OwnerRow): RecipientStatus {
    const account = recipientAddress(row.account_email);
    return {
      recipient:
        row.email === null
          ? null
          : {
              email: row.email,
              state:
                row.verified_at !== null
                  ? "verified"
                  : row.pending_token_hash !== null &&
                      (row.token_expires_at ?? 0) > now()
                    ? "pending"
                    : "unverified",
            },
      accountEmail: row.account_verified === 1 && account ? account : null,
    };
  }
  async function fail(error: RecipientFailure): Promise<RecipientResult> {
    return { ok: false, error, status: project(await read()) };
  }
  async function done(): Promise<RecipientResult> {
    return { ok: true, status: project(await read()) };
  }

  async function useAccountEmail(): Promise<RecipientResult> {
    const row = await read();
    const account = project(row).accountEmail;
    if (!account) return fail("account_email_unverified");
    // Keep an existing verification of the same address, so an unchanged
    // recipient does not invalidate a publication already in progress.
    const result = await db
      .prepare(
        `INSERT INTO contact_recipient(portfolio_id,email,verified_at,pending_token_hash,token_expires_at)
        SELECT p.id,u.email,?,NULL,NULL FROM portfolio p JOIN user u ON u.id=p.user_id
        WHERE p.id=(${owned}) AND u.email=? AND u.email_verified=1
        ON CONFLICT(portfolio_id) DO UPDATE SET
          verified_at=CASE WHEN contact_recipient.email=excluded.email AND contact_recipient.verified_at IS NOT NULL
            THEN contact_recipient.verified_at ELSE excluded.verified_at END,
          email=excluded.email,pending_token_hash=NULL,token_expires_at=NULL`,
      )
      .bind(now(), ...ownedValues(), row.account_email)
      .run();
    // The account email or session changed between the read and the write.
    if (result.meta.changes !== 1) return fail("account_email_unverified");
    return done();
  }

  return {
    status: async () => project(await read()),
    useAccountEmail,

    /** Sets a new recipient and sends its confirmation link. */
    async requestVerification(value: string): Promise<RecipientResult> {
      const email = recipientAddress(value);
      if (!email) return fail("invalid_email");
      const row = await read();
      const status = project(row);
      if (
        status.recipient?.state === "verified" &&
        same(status.recipient.email, email)
      )
        return { ok: true, status };
      if (status.accountEmail && same(status.accountEmail, email))
        return useAccountEmail();
      if (!env.provider) return fail("unavailable");
      const reservation = {
        id: crypto.randomUUID(),
        kind: "verification" as const,
      };
      const at = now();
      if (
        (await reserveEmail(db, {
          ...reservation,
          portfolioId: row.portfolio_id,
          isTest: false,
          acceptedAt: at,
        })) !== "reserved"
      )
        return fail("limited");
      if (
        (await reserveDispatch(db, reservation, `${reservation.id}/1`, at)) !==
        "reserved"
      )
        return fail("limited");
      const token = newToken();
      const hash = await sha256(token);
      const changed = await db
        .prepare(
          `INSERT INTO contact_recipient(portfolio_id,email,verified_at,pending_token_hash,token_expires_at)
          SELECT (${owned}),?,NULL,?,? WHERE EXISTS(${owned})
          ON CONFLICT(portfolio_id) DO UPDATE SET email=excluded.email,verified_at=NULL,
            pending_token_hash=excluded.pending_token_hash,token_expires_at=excluded.token_expires_at`,
        )
        .bind(
          ...ownedValues(),
          email,
          hash,
          at + VERIFICATION_TTL_MS,
          ...ownedValues(),
        )
        .run();
      if (changed.meta.changes !== 1) throw new OwnerAccessError();
      const sent = await env.provider.send(
        verificationEmail(
          email,
          verificationUrl(env.appOrigin, token),
          env.appOrigin,
        ),
        `verification/${reservation.id}`,
      );
      if (sent.status === "accepted") return done();
      // A definite refusal sent nothing, so the address is not awaiting a
      // link. An ambiguous failure (timeout) may still deliver: keep it.
      if (sent.status !== "retry")
        await db
          .prepare(
            `UPDATE contact_recipient SET pending_token_hash=NULL,token_expires_at=NULL
            WHERE portfolio_id=(${owned}) AND pending_token_hash=?`,
          )
          .bind(...ownedValues(), hash)
          .run();
      return fail("delivery_failed");
    },

    /** Confirms the pending recipient with the token from its link. */
    async verify(token: string): Promise<RecipientResult> {
      if (!TOKEN.test(token)) return fail("invalid_token");
      const hash = await sha256(token);
      const verified = await db
        .prepare(
          `UPDATE contact_recipient SET verified_at=?,pending_token_hash=NULL,token_expires_at=NULL
          WHERE portfolio_id=(${owned}) AND pending_token_hash=? AND token_expires_at>?`,
        )
        .bind(now(), ...ownedValues(), hash, now())
        .run();
      if (verified.meta.changes === 1) return done();
      const row = await read();
      return fail(
        row.pending_token_hash === hash ? "expired_token" : "invalid_token",
      );
    },
  };
}
