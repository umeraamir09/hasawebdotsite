import { authSettings } from "@hasaweb/auth";
import {
  type DeliveryFailure,
  ownerContactDelivery,
  ownerContactRecipient,
  privateJson,
  type RecipientFailure,
  type RecipientResult,
} from "@hasaweb/db";
import { type EmailEnvironment, emailProvider } from "@hasaweb/email";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { readBody } from "./draft-routes";
import type { OwnerBindings } from "./owner-api";

// The contact form's private recipient (Phase 43). Every route returns the
// owner's own recipient address, so each requires the expected-owner
// precondition like the email suggestion. Nothing here is public.
export type ContactBindings = Omit<EmailEnvironment, "APP_ENV">;

const failureStatus = {
  invalid_email: 422,
  account_email_unverified: 409,
  limited: 429,
  unavailable: 503,
  delivery_failed: 502,
  invalid_token: 409,
  expired_token: 410,
} as const satisfies Record<RecipientFailure, number>;
const emptySchema = z.strictObject({});
const requestSchema = z.strictObject({ email: z.string().max(1024) });
const verifySchema = z.strictObject({ token: z.string().max(256) });

type ContactContext = Context<OwnerBindings>;
function service(c: ContactContext) {
  return ownerContactRecipient(c.env.DB, c.get("identity"), {
    provider: emailProvider(c.env),
    appOrigin: authSettings(c.env).origin,
  });
}
const respond = (result: RecipientResult) =>
  result.ok
    ? privateJson(result.status)
    : privateJson(
        { error: result.error, ...result.status },
        failureStatus[result.error],
      );
async function parse<T>(c: ContactContext, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await readBody(c.req.raw, 2048));
  return parsed.success ? parsed.data : null;
}
const invalid = () => privateJson({ error: "invalid_input" }, 422);

export const CONTACT_RECIPIENT_PATH = "/api/owner/contact/recipient";
// Delivery status and Send test message (Phase 45). No message content.
export const CONTACT_DELIVERY_PATH = "/api/owner/contact/delivery";
const deliveryStatus = {
  no_recipient: 409,
  limited: 429,
  unavailable: 503,
} as const satisfies Record<DeliveryFailure, number>;
const delivery = (c: ContactContext) =>
  ownerContactDelivery(c.env.DB, c.get("identity"), {
    provider: emailProvider(c.env),
  });

export function addContactRoutes(app: Hono<OwnerBindings>) {
  app.use(`${CONTACT_RECIPIENT_PATH}/*`, expectedOwner);
  app.use(CONTACT_RECIPIENT_PATH, expectedOwner);
  app.get(CONTACT_RECIPIENT_PATH, async (c) =>
    privateJson(await service(c).status()),
  );
  // Sets a new address and sends its confirmation link.
  app.post(CONTACT_RECIPIENT_PATH, async (c) => {
    const command = await parse(c, requestSchema);
    if (!command) return invalid();
    return respond(await service(c).requestVerification(command.email));
  });
  // Uses the account's provider-verified email, which needs no link.
  app.post(`${CONTACT_RECIPIENT_PATH}/account`, async (c) => {
    if (!(await parse(c, emptySchema))) return invalid();
    return respond(await service(c).useAccountEmail());
  });
  app.post(`${CONTACT_RECIPIENT_PATH}/verify`, async (c) => {
    const command = await parse(c, verifySchema);
    if (!command) return invalid();
    return respond(await service(c).verify(command.token));
  });
  for (const action of ["", "/account", "/verify"])
    app.all(`${CONTACT_RECIPIENT_PATH}${action}`, () =>
      privateJson({ error: "invalid_input" }, 405),
    );

  app.use(`${CONTACT_DELIVERY_PATH}/*`, expectedOwner);
  app.use(CONTACT_DELIVERY_PATH, expectedOwner);
  app.get(CONTACT_DELIVERY_PATH, async (c) =>
    privateJson(await delivery(c).status()),
  );
  app.post(`${CONTACT_DELIVERY_PATH}/test`, async (c) => {
    if (!(await parse(c, emptySchema))) return invalid();
    const result = await delivery(c).sendTest();
    return result.ok
      ? privateJson({ outcome: result.outcome, ...result.status })
      : privateJson(
          { error: result.error, ...result.status },
          deliveryStatus[result.error],
        );
  });
  for (const action of ["", "/test"])
    app.all(`${CONTACT_DELIVERY_PATH}${action}`, () =>
      privateJson({ error: "invalid_input" }, 405),
    );
}

// A stale-account precondition, never an authorization source.
async function expectedOwner(c: ContactContext, next: () => Promise<void>) {
  const expected = c.req.header("X-Expected-Owner-Id");
  if (!expected) return privateJson({ error: "invalid_input" }, 400);
  if (expected !== c.get("identity").user.id)
    return privateJson({ error: "owner_changed" }, 409);
  await next();
}
