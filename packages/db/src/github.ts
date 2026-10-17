import {
  credentialBinding,
  decryptActivityToken,
  deleteActivityGrant,
  encryptActivityToken,
  type GitHubIdentity,
  type GrantTransport,
  type GraphState,
  parseCalendar,
  parseIdentity,
  type RefreshResult,
  type RefreshTicket,
  sameIdentity,
} from "@hasaweb/github";
import type { SessionIdentity } from "./repositories";

type Connection = {
  portfolio_id: string;
  login: string;
  github_user_id: string;
  generation: number;
  app_id: string | null;
  grant_operation: string | null;
  token_enc: string | null;
  token_binding: string | null;
  private_enabled: number;
  status: "ok" | "needs_reconnect" | "disconnected";
};
export type ConsentTicket = RefreshTicket & {
  appId: string;
  operationId: string;
};
type BindingValue = string | number | null;
const query = (db: D1Database, sql: string, ...values: BindingValue[]) =>
  db.prepare(sql).bind(...values);
const ticketValues = (ticket: RefreshTicket) => [
  ticket.portfolioId,
  ticket.generation,
  ticket.identity.id,
  ticket.identity.login.toLowerCase(),
];
const currentTicket = `portfolio_id=? AND generation=? AND github_user_id=? AND lower(login)=?`;
const activeGrant = (
  alias = "github_connection",
) => `${alias}.private_enabled=1 AND ${alias}.status='ok' AND ${alias}.token_enc IS NOT NULL
  AND EXISTS (SELECT 1 FROM github_grant g WHERE g.app_id=${alias}.app_id
  AND g.github_user_id=${alias}.github_user_id AND g.state='active'
  AND g.operation_id=${alias}.grant_operation AND g.portfolio_id=${alias}.portfolio_id
  AND g.generation=${alias}.generation)`;
const liveOwner = `EXISTS (SELECT 1 FROM portfolio p JOIN user u ON u.id=p.user_id
  WHERE p.id=github_connection.portfolio_id AND u.deleting_at IS NULL)`;

function connectionView(row: Connection) {
  return {
    portfolioId: row.portfolio_id,
    identity: { id: row.github_user_id, login: row.login },
    generation: row.generation,
    privateEnabled: row.private_enabled === 1,
    status: row.status,
  };
}

// Only trusted jobs receive this repository. There are no HTTP routes in 11D.
export function githubJobs(db: D1Database) {
  return {
    async capture(portfolioId: string, source: "public" | "authorized") {
      const row = await query(
        db,
        `SELECT * FROM github_connection WHERE portfolio_id=? AND ${liveOwner}
        ${source === "authorized" ? `AND ${activeGrant()}` : ""}`,
        portfolioId,
      ).first<Connection>();
      if (!row) return null;
      const ticket: RefreshTicket = {
        portfolioId,
        generation: row.generation,
        identity: { id: row.github_user_id, login: row.login },
      };
      return source === "authorized"
        ? { ticket, tokenEnc: row.token_enc, tokenBinding: row.token_binding }
        : { ticket, tokenEnc: null, tokenBinding: null };
    },
    async refresh(
      ticket: RefreshTicket,
      result: RefreshResult,
      now = Date.now(),
    ) {
      parseIdentity(ticket.identity);
      const source = result.kind === "error" ? result.source : result.kind;
      const predicate = `${currentTicket} AND ${liveOwner} ${source === "authorized" ? `AND ${activeGrant()}` : ""}`;
      const params = ticketValues(ticket);
      if (
        result.kind === "error" &&
        ![
          "credential",
          "rate",
          "server",
          "network",
          "scope",
          "identity",
          "payload",
        ].includes(result.error)
      )
        throw new Error("Invalid refresh error");
      if (
        result.kind === "error" &&
        source === "authorized" &&
        ["credential", "scope", "identity"].includes(result.error)
      ) {
        const rows = await db.batch([
          query(
            db,
            `UPDATE github_grant SET state='pending', token_enc=(SELECT token_enc FROM github_connection WHERE ${predicate}),
            token_binding=(SELECT token_binding FROM github_connection WHERE ${predicate}), retry_at=?, last_error=NULL
            WHERE state='active' AND EXISTS(SELECT 1 FROM github_connection WHERE ${predicate}
            AND github_connection.app_id=github_grant.app_id AND github_connection.github_user_id=github_grant.github_user_id
            AND github_connection.grant_operation=github_grant.operation_id)`,
            ...params,
            ...params,
            now,
            ...params,
          ),
          // The first statement changes the grant state, so recheck the ticket, not activeGrant.
          query(
            db,
            `UPDATE github_connection SET generation=generation+1, token_enc=NULL, token_binding=NULL,
            private_enabled=0, status='needs_reconnect', app_id=NULL, grant_operation=NULL, scopes='', last_checked_at=?
            WHERE ${currentTicket} AND ${liveOwner} AND private_enabled=1
            AND EXISTS(SELECT 1 FROM github_grant g WHERE g.app_id=github_connection.app_id
              AND g.github_user_id=github_connection.github_user_id AND g.operation_id=github_connection.grant_operation AND g.state='pending')`,
            now,
            ...params,
          ),
          query(
            db,
            `UPDATE github_activity SET generation=?, authorized_calendar=NULL, private_counts=NULL, authorized_error=?
            WHERE portfolio_id=? AND generation=? AND EXISTS(SELECT 1 FROM github_connection WHERE ${currentTicket})`,
            ticket.generation + 1,
            result.error,
            ticket.portfolioId,
            ticket.generation,
            ...ticketValues({ ...ticket, generation: ticket.generation + 1 }),
          ),
        ]);
        return rows[1]?.meta.changes === 1;
      }
      const calendar =
        result.kind === "error" || result.calendar === null
          ? null
          : parseCalendar(result.calendar);
      const column =
        source === "public" ? "public_calendar" : "authorized_calendar";
      const errorColumn =
        source === "public" ? "public_error" : "authorized_error";
      const preserve =
        result.kind === "error" &&
        !(
          source === "public" &&
          ["scope", "identity", "payload"].includes(result.error)
        );
      const rows = await db.batch([
        query(
          db,
          `INSERT INTO github_activity(portfolio_id,public_days,generation,${column},${errorColumn})
          SELECT portfolio_id,'[]',generation,?,? FROM github_connection WHERE ${predicate}
          ON CONFLICT(portfolio_id) DO UPDATE SET generation=excluded.generation,
          ${column}=${preserve ? `github_activity.${column}` : `excluded.${column}`}, ${errorColumn}=excluded.${errorColumn}`,
          calendar ? JSON.stringify(calendar) : null,
          result.kind === "error" ? result.error : null,
          ...params,
        ),
        query(
          db,
          `UPDATE github_connection SET last_checked_at=? WHERE ${predicate}`,
          now,
          ...params,
        ),
      ]);
      return rows[0]?.meta.changes === 1;
    },
    async servingState(portfolioId: string): Promise<GraphState | null> {
      // One read sees authorization, generation and cache from the same D1 snapshot.
      const row = await query(
        db,
        `SELECT c.login,c.github_user_id,c.generation,
        CASE WHEN ${activeGrant("c")} THEN 1 ELSE 0 END AS authorized,
        a.generation AS cache_generation,a.public_calendar,a.authorized_calendar
        FROM github_connection c JOIN portfolio p ON p.id=c.portfolio_id JOIN user u ON u.id=p.user_id
        LEFT JOIN github_activity a ON a.portfolio_id=c.portfolio_id WHERE c.portfolio_id=? AND u.deleting_at IS NULL`,
        portfolioId,
      ).first<{
        login: string;
        github_user_id: string;
        generation: number;
        authorized: number;
        cache_generation: number | null;
        public_calendar: string | null;
        authorized_calendar: string | null;
      }>();
      if (!row) return null;
      const decode = (value: string | null): unknown => {
        try {
          return value === null ? null : JSON.parse(value);
        } catch {
          return null;
        }
      };
      return {
        identity: { id: row.github_user_id, login: row.login },
        generation: row.generation,
        privateAuthorized: row.authorized === 1,
        activity:
          row.cache_generation === null
            ? null
            : {
                generation: row.cache_generation,
                publicCalendar: decode(row.public_calendar),
                authorizedCalendar: decode(row.authorized_calendar),
              },
      };
    },
  };
}

export function ownerGithub(db: D1Database, sourceIdentity: SessionIdentity) {
  const userId = sourceIdentity.user.id;
  const sessionId = sourceIdentity.session.id;
  const owned = `SELECT p.id FROM portfolio p JOIN user u ON u.id=p.user_id JOIN session s ON s.user_id=u.id
    WHERE u.id=? AND s.id=? AND s.expires_at>? AND u.deleting_at IS NULL`;
  const ownerValues = () => [userId, sessionId, Date.now()];
  async function requirePortfolio() {
    const row = await query(db, owned, ...ownerValues()).first<{
      id: string;
    }>();
    if (!row) throw new Error("An active owner portfolio is required");
    return row.id;
  }
  const read = () =>
    query(
      db,
      `SELECT * FROM github_connection WHERE portfolio_id IN (${owned})`,
      ...ownerValues(),
    ).first<Connection>();
  async function transition(
    expectedGeneration: number,
    selected: GitHubIdentity | null,
  ) {
    await requirePortfolio();
    const current = await read();
    if (!current || current.generation !== expectedGeneration) return null;
    const next = selected
      ? parseIdentity(selected)
      : { id: current.github_user_id, login: current.login };
    const predicate = `portfolio_id=? AND generation=? AND portfolio_id IN (${owned})`;
    const params = [current.portfolio_id, expectedGeneration, ...ownerValues()];
    const rows = await db.batch([
      query(
        db,
        `UPDATE github_grant SET state='pending',token_enc=(SELECT token_enc FROM github_connection WHERE ${predicate}),
        token_binding=(SELECT token_binding FROM github_connection WHERE ${predicate}),retry_at=0,last_error=NULL
        WHERE state='active' AND app_id=? AND github_user_id=? AND operation_id=?
        AND EXISTS(SELECT 1 FROM github_connection WHERE ${predicate})`,
        ...params,
        ...params,
        current.app_id,
        current.github_user_id,
        current.grant_operation,
        ...params,
      ),
      query(
        db,
        `UPDATE github_connection SET generation=generation+1,login=?,github_user_id=?,private_enabled=0,
        token_enc=NULL,token_binding=NULL,app_id=NULL,grant_operation=NULL,scopes='',status='disconnected'
        WHERE ${predicate} RETURNING *`,
        next.login,
        next.id,
        ...params,
      ),
      query(
        db,
        `UPDATE github_activity SET generation=?,authorized_calendar=NULL,private_counts=NULL,authorized_error=NULL,
        public_calendar=${selected ? "NULL" : "public_calendar"},public_error=NULL
        WHERE portfolio_id=? AND generation=? AND EXISTS(SELECT 1 FROM github_connection
          WHERE portfolio_id=? AND generation=? AND portfolio_id IN (${owned}))`,
        expectedGeneration + 1,
        current.portfolio_id,
        expectedGeneration,
        current.portfolio_id,
        expectedGeneration + 1,
        ...ownerValues(),
      ),
    ]);
    const row = rows[1]?.results[0] as Connection | undefined;
    return row ? connectionView(row) : null;
  }
  return {
    async getConnection() {
      const row = await read();
      return row ? connectionView(row) : undefined;
    },
    async getActivity() {
      const row = await query(
        db,
        `SELECT generation,public_calendar,authorized_calendar,public_error,authorized_error
        FROM github_activity WHERE portfolio_id IN (${owned})`,
        ...ownerValues(),
      ).first();
      return row ?? undefined;
    },
    async select(identity: GitHubIdentity, expectedGeneration: number | null) {
      const selected = parseIdentity(identity);
      await requirePortfolio();
      if (expectedGeneration !== null)
        return transition(expectedGeneration, selected);
      const row = await query(
        db,
        `INSERT INTO github_connection(portfolio_id,login,github_user_id,generation,status)
        SELECT id,?,?,1,'disconnected' FROM (${owned}) WHERE true ON CONFLICT(portfolio_id) DO NOTHING RETURNING *`,
        selected.login,
        selected.id,
        ...ownerValues(),
      ).first<Connection>();
      return row ? connectionView(row) : null;
    },
    disconnect: (expectedGeneration: number) =>
      transition(expectedGeneration, null),
    async beginConsent(
      appId: string,
      expectedGeneration: number,
    ): Promise<ConsentTicket | null> {
      const portfolioId = await requirePortfolio();
      const connection = await read();
      if (!connection || connection.generation !== expectedGeneration)
        return null;
      if (!/^[a-z\d._-]{1,256}$/i.test(appId))
        throw new Error("Invalid activity app");
      const operationId = crypto.randomUUID();
      const row = await query(
        db,
        `INSERT INTO github_grant(app_id,github_user_id,portfolio_id,operation_id,generation,state)
        SELECT ?,github_user_id,portfolio_id,?,generation,'consent' FROM github_connection
        WHERE portfolio_id=? AND generation=? AND private_enabled=0 AND portfolio_id IN (${owned})
        AND NOT EXISTS(SELECT 1 FROM github_legacy_credential l WHERE l.github_user_id=github_connection.github_user_id)
        ON CONFLICT(app_id,github_user_id) DO UPDATE SET portfolio_id=excluded.portfolio_id,operation_id=excluded.operation_id,
          generation=excluded.generation,state='consent',token_enc=NULL,token_binding=NULL,attempt_id=NULL,attempts=0,retry_at=0,last_error=NULL
        WHERE github_grant.state='idle' RETURNING github_user_id`,
        appId,
        operationId,
        portfolioId,
        expectedGeneration,
        ...ownerValues(),
      ).first<{ github_user_id: string }>();
      if (!row) return null;
      // A concurrent removal is handled by finishConsent, which queues any issued token.
      return {
        portfolioId,
        appId,
        operationId,
        generation: expectedGeneration,
        identity: { id: row.github_user_id, login: connection.login },
      };
    },
    async finishConsent(
      ticket: ConsentTicket,
      key: CryptoKey,
      token: string,
      scopes: string,
      verifiedIdentity: GitHubIdentity,
    ) {
      const portfolioId = await requirePortfolio();
      if (
        ticket.portfolioId !== portfolioId ||
        scopes !== "read:user" ||
        !sameIdentity(parseIdentity(verifiedIdentity), ticket.identity)
      )
        throw new Error("Invalid activity consent");
      parseIdentity(ticket.identity);
      const binding = credentialBinding(
        portfolioId,
        ticket.appId,
        ticket.identity.id,
        ticket.operationId,
      );
      const envelope = await encryptActivityToken(key, token, binding);
      const valid = `${currentTicket} AND private_enabled=0 AND portfolio_id IN (${owned})`;
      const matchGrant = `app_id=? AND github_user_id=? AND operation_id=? AND portfolio_id=? AND state='consent' AND generation=?`;
      const grantValues = [
        ticket.appId,
        ticket.identity.id,
        ticket.operationId,
        portfolioId,
      ];
      const rows = await db.batch([
        query(
          db,
          `UPDATE github_grant SET generation=generation+1,state=CASE WHEN EXISTS(SELECT 1 FROM github_connection WHERE ${valid}) THEN 'active' ELSE 'pending' END,
          token_enc=CASE WHEN EXISTS(SELECT 1 FROM github_connection WHERE ${valid}) THEN NULL ELSE ? END,
          token_binding=CASE WHEN EXISTS(SELECT 1 FROM github_connection WHERE ${valid}) THEN NULL ELSE ? END
          WHERE ${matchGrant}`,
          ...ticketValues(ticket),
          ...ownerValues(),
          ...ticketValues(ticket),
          ...ownerValues(),
          envelope,
          ...ticketValues(ticket),
          ...ownerValues(),
          binding,
          ...grantValues,
          ticket.generation,
        ),
        query(
          db,
          `UPDATE github_connection SET generation=generation+1,app_id=?,grant_operation=?,token_enc=?,token_binding=?,
          private_enabled=1,scopes='read:user',status='ok' WHERE ${valid}
          AND EXISTS(SELECT 1 FROM github_grant WHERE app_id=? AND github_user_id=? AND operation_id=? AND portfolio_id=? AND state='active' AND generation=?) RETURNING *`,
          ticket.appId,
          ticket.operationId,
          envelope,
          binding,
          ...ticketValues(ticket),
          ...ownerValues(),
          ...grantValues,
          ticket.generation + 1,
        ),
        query(
          db,
          `UPDATE github_activity SET generation=?,authorized_calendar=NULL,private_counts=NULL,authorized_error=NULL
          WHERE portfolio_id=? AND generation=? AND EXISTS(SELECT 1 FROM github_connection WHERE ${currentTicket} AND grant_operation=?)`,
          ticket.generation + 1,
          portfolioId,
          ticket.generation,
          ...ticketValues({ ...ticket, generation: ticket.generation + 1 }),
          ticket.operationId,
        ),
      ]);
      const row = rows[1]?.results[0] as Connection | undefined;
      return row ? connectionView(row) : null;
    },
    // Call only when the OAuth flow proves no token was issued/exchange started.
    async cancelUnissuedConsent(ticket: ConsentTicket) {
      const portfolioId = await requirePortfolio();
      const result = await query(
        db,
        `UPDATE github_grant SET state='idle' WHERE app_id=? AND github_user_id=? AND operation_id=?
        AND state='consent' AND portfolio_id=? AND portfolio_id IN (${owned})`,
        ticket.appId,
        ticket.identity.id,
        ticket.operationId,
        portfolioId,
        ...ownerValues(),
      ).run();
      return result.meta.changes === 1;
    },
    cleanupStatus: () =>
      query(
        db,
        `SELECT state,attempts,retry_at,last_error FROM github_grant
      WHERE portfolio_id IN (${owned}) AND state IN ('pending','inflight','uncertain')`,
        ...ownerValues(),
      ).all(),
  };
}

export type CleanupTicket = {
  appId: string;
  githubUserId: string;
  operationId: string;
};

export async function pendingGitHubCleanups(
  db: D1Database,
  now = Date.now(),
  limit = 50,
): Promise<CleanupTicket[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("Invalid cleanup batch size");
  const rows = await query(
    db,
    `SELECT app_id,github_user_id,operation_id FROM github_grant
    WHERE state='pending' AND retry_at<=? ORDER BY retry_at,app_id,github_user_id LIMIT ?`,
    now,
    limit,
  ).all<{
    app_id: string;
    github_user_id: string;
    operation_id: string;
  }>();
  return rows.results.map((row) => ({
    appId: row.app_id,
    githubUserId: row.github_user_id,
    operationId: row.operation_id,
  }));
}

// A delivery carries only the immutable ticket, never a credential or reusable claim.
export async function runGitHubGrantCleanup(
  db: D1Database,
  ticket: CleanupTicket,
  key: CryptoKey,
  app: { id: string; secret: string },
  transport: GrantTransport,
  now = Date.now(),
) {
  if (app.id !== ticket.appId) throw new Error("Activity app mismatch");
  const attemptId = crypto.randomUUID();
  const row = await query(
    db,
    `UPDATE github_grant SET state='inflight',attempt_id=?,attempts=attempts+1
    WHERE app_id=? AND github_user_id=? AND operation_id=? AND state='pending' AND retry_at<=?
    RETURNING token_enc,token_binding`,
    attemptId,
    ticket.appId,
    ticket.githubUserId,
    ticket.operationId,
    now,
  ).first<{ token_enc: string; token_binding: string }>();
  if (!row) return "skipped" as const;
  let outcome: "deleted" | "retry" | "uncertain";
  try {
    const token = await decryptActivityToken(
      key,
      row.token_enc,
      row.token_binding,
    );
    outcome = await deleteActivityGrant(transport, app, token);
  } catch {
    outcome = "retry";
  }
  await query(
    db,
    `UPDATE github_grant SET state=?,token_enc=${outcome === "deleted" ? "NULL" : "token_enc"},
    token_binding=${outcome === "deleted" ? "NULL" : "token_binding"},retry_at=?,last_error=?
    WHERE app_id=? AND github_user_id=? AND operation_id=? AND state='inflight' AND attempt_id=?`,
    outcome === "deleted"
      ? "idle"
      : outcome === "retry"
        ? "pending"
        : "uncertain",
    now + 60_000,
    outcome === "deleted" ? null : outcome,
    ticket.appId,
    ticket.githubUserId,
    ticket.operationId,
    attemptId,
  ).run();
  return outcome;
}
