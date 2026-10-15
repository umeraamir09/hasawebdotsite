export type EmailKind = "verification" | "contact" | "failure-notice";
export type Email = {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
};
export type SendResult =
  | { status: "accepted"; id: string }
  | {
      status: "rejected" | "retry" | "quota";
      code: string;
      retryAfterMs: number | null;
    };
export interface EmailProvider {
  send(email: Email, idempotencyKey: string): Promise<SendResult>;
}
export type Transport = typeof fetch;

// One recipient and a fixed sender keep quota accounting unambiguous.
export function validAddress(address: string): boolean {
  return /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address);
}
function validate(email: Email, key: string) {
  if (
    !validAddress(email.to) ||
    (email.replyTo !== undefined && !validAddress(email.replyTo)) ||
    /[\r\n]/.test(email.subject) ||
    !email.subject ||
    !email.text ||
    !/^[A-Za-z0-9/_-]{1,256}$/.test(key)
  ) {
    throw new Error("Invalid email envelope or idempotency key");
  }
}
function retryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export class ResendProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly transport: Transport = fetch,
    private readonly timeoutMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!apiKey || !validAddress(from) || timeoutMs <= 0)
      throw new Error("Invalid Resend configuration");
  }

  async send(email: Email, key: string): Promise<SendResult> {
    validate(email, key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          from: this.from,
          to: [email.to],
          subject: email.subject,
          text: email.text,
          ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        }),
      });
      const delay = retryAfter(response.headers.get("Retry-After"), this.now());
      let body: { id?: unknown; name?: unknown } = {};
      try {
        body = (await response.json()) ?? {};
      } catch {
        // Classification still uses HTTP status if a proxy returns non-JSON.
      }
      if (response.ok) {
        return typeof body.id === "string" && body.id.length > 0
          ? { status: "accepted", id: body.id }
          : { status: "retry", code: "invalid_response", retryAfterMs: delay };
      }
      // Never retain the provider's message, which may contain private data.
      const known = new Set([
        "daily_quota_exceeded",
        "monthly_quota_exceeded",
        "rate_limit_exceeded",
        "concurrent_idempotent_requests",
        "invalid_idempotent_request",
        "validation_error",
        "restricted_api_key",
        "missing_api_key",
        "invalid_permission",
        "suspended_api_key",
        "resource_locked",
        "application_error",
        "service_unavailable",
      ]);
      const code =
        typeof body.name === "string" && known.has(body.name)
          ? body.name
          : `http_${response.status}`;
      if (
        response.status === 429 &&
        ["daily_quota_exceeded", "monthly_quota_exceeded"].includes(code)
      ) {
        return { status: "quota", code, retryAfterMs: delay };
      }
      return {
        status:
          response.status === 429 ||
          response.status >= 500 ||
          response.status === 408 ||
          (response.status === 409 &&
            ["concurrent_idempotent_requests", "resource_locked"].includes(
              code,
            ))
            ? "retry"
            : "rejected",
        code,
        retryAfterMs: delay,
      };
    } catch {
      return {
        status: "retry",
        code: controller.signal.aborted ? "timeout" : "network_error",
        retryAfterMs: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// The development caller chooses the local sink. Never use this in production.
export class ConsoleProvider implements EmailProvider {
  constructor(private readonly write: (email: Email) => void) {}
  async send(email: Email, key: string): Promise<SendResult> {
    validate(email, key);
    this.write(email);
    return { status: "accepted", id: `console/${key}` };
  }
}

export function verificationEmail(to: string, verificationUrl: string): Email {
  const url = new URL(verificationUrl);
  if (
    url.origin !== "https://hasaweb.site" ||
    url.pathname !== "/settings/contact/verify" ||
    /[\r\n]/.test(verificationUrl)
  )
    throw new Error("Invalid verification URL");
  return {
    kind: "verification",
    to,
    subject: "Verify your hasaweb.site contact address",
    text: `Verify this address for your portfolio contact form:\n\n${url.href}\n\nIf you did not request this change, ignore this email.`,
  };
}
export function contactEmail(
  to: string,
  visitor: { name: string; email: string; message: string },
): Email {
  return {
    kind: "contact",
    to,
    replyTo: visitor.email,
    subject: "New message from your hasaweb.site portfolio",
    text: `Name: ${visitor.name}\nEmail: ${visitor.email}\n\n${visitor.message}`,
  };
}
export function failureNotice(to: string): Email {
  return {
    kind: "failure-notice",
    to,
    subject: "A portfolio message could not be delivered",
    text: "A message accepted by your hasaweb.site contact form could not be delivered. Open your portfolio settings to review delivery status. The visitor's message is no longer retained.",
  };
}
