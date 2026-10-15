import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parseEnv } from "node:util";

// Use Wrangler's installed transpiler so this works on Node builds without TS support.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { build } = wranglerRequire("esbuild");
const compiled = await build({
  entryPoints: [
    new URL("../packages/email/src/index.ts", import.meta.url).pathname,
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node22",
});
const {
  contactEmail,
  failureNotice,
  ResendProvider,
  validAddress,
  verificationEmail,
} = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString("base64")}`
);

const root = new URL("../", import.meta.url);
const envPath = new URL(".env.email-spike.local", root);
const journalPath = new URL(".wrangler/email-live/journal.json", root);
const evidencePath = new URL(
  "specs/2026-10-15-email-delivery/live-evidence.json",
  root,
);
const send = process.argv.includes("--send");
const allowed = new Set([
  "delivered",
  "sent",
  "queued",
  "bounced",
  "failed",
  "delivery_delayed",
  "suppressed",
  "opened",
  "clicked",
]);

async function run() {
  let env;
  try {
    env = parseEnv(await readFile(envPath, "utf8"));
  } catch {
    throw new Error("Create the ignored .env.email-spike.local first");
  }
  const required = [
    "RESEND_API_KEY",
    "RESEND_DOMAIN_ID",
    "EMAIL_FROM",
    "EMAIL_TEST_TO",
  ];
  const missing = required.filter((key) => !env[key]);
  if (missing.length)
    throw new Error(`Fill in ${missing.join(", ")} in the ignored env file`);
  if (!validAddress(env.EMAIL_FROM) || !validAddress(env.EMAIL_TEST_TO))
    throw new Error(
      "EMAIL_FROM and EMAIL_TEST_TO must each contain one plain email address",
    );
  const domainName = env.EMAIL_SENDING_DOMAIN || "hasaweb.site";
  if (env.EMAIL_FROM.split("@")[1] !== domainName)
    throw new Error("EMAIL_FROM must match EMAIL_SENDING_DOMAIN exactly");
  const get = async (path) => {
    const response = await fetch(`https://api.resend.com${path}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(
        `Resend read-only check failed with HTTP ${response.status}. Check key permissions and account configuration`,
      );
    return response.json();
  };
  const domain = await get(
    `/domains/${encodeURIComponent(env.RESEND_DOMAIN_ID)}`,
  );
  const records = (domain.records || []).filter((record) =>
    ["SPF", "DKIM"].includes(record.record),
  );
  const verified =
    domain.name === domainName &&
    domain.status === "verified" &&
    ["SPF", "DKIM"].every((type) =>
      records.some((record) => record.record === type),
    ) &&
    records.every((record) => record.status === "verified") &&
    domain.capabilities?.sending !== "disabled";
  if (!verified)
    throw new Error(
      "Sending domain and its SPF/DKIM records must all be verified before the live send",
    );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([env.EMAIL_FROM, env.EMAIL_TEST_TO, env.RESEND_DOMAIN_ID]),
    )
    .digest("hex");
  let journal;
  try {
    journal = JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(
        "Live journal is unreadable; refusing to risk duplicate sends",
      );
  }
  if (journal && journal.fingerprint !== fingerprint)
    throw new Error(
      "Live journal belongs to a different envelope. Review it before changing the sender or recipient",
    );
  const evidence = {
    checkedAt: new Date().toISOString(),
    domain: {
      name: domain.name,
      status: domain.status,
      records: records.map((record) => ({
        record: record.record,
        type: record.type,
        status: record.status,
      })),
    },
    quotaBehavior: "Controlled fixtures only; the real quota is not exhausted.",
    messages: [],
    allDelivered: false,
  };
  const templates = [
    verificationEmail(
      env.EMAIL_TEST_TO,
      "https://hasaweb.site/settings/contact/verify?token=s7-delivery-test-only",
    ),
    contactEmail(env.EMAIL_TEST_TO, {
      name: "S-7 test visitor",
      email: env.EMAIL_TEST_TO,
      message: "Authorized contact delivery test. No reply is needed.",
    }),
    failureNotice(env.EMAIL_TEST_TO),
  ].map((email) => ({
    ...email,
    text: `This is an authorized S-7 email delivery test. No verification or delivery failure has occurred in your account. The verification link is a fixture and does not change your settings.\n\n${email.text}`,
  }));
  const persist = async () => {
    await mkdir(new URL(".wrangler/email-live/", root), { recursive: true });
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, {
      mode: 0o600,
    });
  };
  if (send && !journal) {
    journal = {
      fingerprint,
      run: randomUUID(),
      startedAt: Date.now(),
      messages: {},
    };
    await persist();
  }
  const provider = new ResendProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
  for (const email of templates) {
    let saved = journal?.messages[email.kind];
    if (send && !saved?.id) {
      // Resend retains idempotency keys for 24h. Never resend ambiguous work after that window.
      if (Date.now() - journal.startedAt >= 23 * 60 * 60 * 1000)
        throw new Error(
          "Ambiguous send is older than the safe idempotency window. Review the provider dashboard without resending",
        );
      const key = `s7/${journal.run}/${email.kind}`;
      saved = await provider.send(email, key);
      journal.messages[email.kind] = saved;
      await persist();
      if (saved.status !== "accepted") {
        evidence.messages.push({ kind: email.kind, ...saved });
        await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
        throw new Error(
          `Live ${email.kind} send returned ${saved.status}; see sanitized evidence before retrying`,
        );
      }
      // Bound API request rate; delivery polling is read-only.
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (!saved?.id) {
      evidence.messages.push({ kind: email.kind, status: "not-sent" });
      continue;
    }
    const delivered = await get(`/emails/${encodeURIComponent(saved.id)}`);
    const event = allowed.has(delivered.last_event)
      ? delivered.last_event
      : "unknown";
    evidence.messages.push({
      kind: email.kind,
      id: saved.id,
      status: "accepted",
      lastEvent: event,
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  evidence.allDelivered =
    evidence.messages.length === 3 &&
    evidence.messages.every((message) => message.lastEvent === "delivered");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.allDelivered)
    console.log(
      "Delivery is pending. Re-run without --send to retrieve status without sending mail.",
    );
}
async function lockedRun() {
  const directory = new URL(".wrangler/email-live/", root);
  await mkdir(directory, { recursive: true });
  const lockPath = new URL("lock", directory);
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new Error(
      "Live journal is locked by another run. If it crashed, inspect the journal before removing .wrangler/email-live/lock",
    );
  }
  try {
    await run();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
lockedRun().catch((error) => {
  // Do not print API response bodies, request options, or raw network errors.
  const safe =
    error instanceof Error &&
    /^(Create |Fill in |EMAIL_|Sending domain|Resend read-only|Live journal|Live (verification|contact|failure-notice) send|Ambiguous send)/.test(
      error.message,
    );
  console.error(
    safe
      ? error.message
      : "Live email check failed. Inspect credentials/network locally; no private provider data was logged.",
  );
  process.exitCode = 1;
});
