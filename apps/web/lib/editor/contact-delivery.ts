import { z } from "zod";

// Browser adapter for the owner-only delivery routes (Phase 45): delivery
// status and Send test message. Responses carry no message content.

const notice = z.enum(["pending", "deferred", "sent", "failed"]);
const statusSchema = z.object({
  delivering: z.number().int().nonnegative(),
  test: z
    .strictObject({
      state: z.enum(["delivering", "sent", "failed"]),
      acceptedAt: z.number(),
    })
    .nullable(),
  failures: z
    .array(
      z.strictObject({
        acceptedAt: z.number(),
        failedAt: z.number(),
        notice,
      }),
    )
    .max(10),
});
export type DeliveryStatus = z.infer<typeof statusSchema>;
const testSchema = statusSchema.extend({
  outcome: z.enum(["sent", "retrying", "failed"]),
});
export type TestOutcome = z.infer<typeof testSchema>["outcome"];

const failureSchema = z.enum([
  "no_recipient",
  "limited",
  "unavailable",
  "owner_changed",
  "signed_out",
]);
export type DeliveryFailure = z.infer<typeof failureSchema>;
export class DeliveryError extends Error {
  constructor(
    readonly code: DeliveryFailure,
    readonly status: DeliveryStatus | null = null,
  ) {
    super(code);
  }
}

async function call<T>(
  ownerId: string,
  path: "" | "/test",
  schema: z.ZodType<T>,
  send: typeof fetch,
): Promise<T> {
  const post = path === "/test";
  let response: Response;
  try {
    response = await send(`/api/owner/contact/delivery${path}`, {
      method: post ? "POST" : "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "X-Expected-Owner-Id": ownerId,
        ...(post ? { "Content-Type": "application/json" } : {}),
      },
      ...(post ? { body: "{}" } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new DeliveryError("unavailable");
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) return schema.parse(json);
  if (response.status === 401) throw new DeliveryError("signed_out");
  const error = z.object({ error: z.string() }).safeParse(json);
  const code = failureSchema.safeParse(error.success ? error.data.error : "");
  const status = statusSchema.safeParse(json);
  throw new DeliveryError(
    code.success ? code.data : "unavailable",
    status.success ? status.data : null,
  );
}

export const readDelivery = (ownerId: string, send: typeof fetch = fetch) =>
  call(ownerId, "", statusSchema, send);
export const sendTestMessage = (ownerId: string, send: typeof fetch = fetch) =>
  call(ownerId, "/test", testSchema, send);

export const testOutcomeMessages: Record<TestOutcome, string> = {
  sent: "Test message sent. Check your recipient inbox.",
  retrying:
    "The test message couldn't be sent yet. We'll keep retrying for up to 24 hours.",
  failed:
    "The test message couldn't be delivered. Check the recipient address and try again.",
};
export const deliveryMessages: Record<DeliveryFailure, string> = {
  no_recipient: "Confirm a recipient address before sending a test message.",
  limited: "You can send two test messages a day. Try again tomorrow.",
  unavailable: "Email isn't available right now. Try again later.",
  owner_changed:
    "You're signed in to a different account now. Reload to continue.",
  signed_out: "Sign in to continue.",
};
export const noticeMessages: Record<
  DeliveryStatus["failures"][number]["notice"],
  string
> = {
  sent: "We emailed you about it.",
  pending: "We're emailing you about it.",
  deferred:
    "Today's notification limit was reached, so we'll email you about it tomorrow.",
  failed: "We couldn't email you about it.",
};
