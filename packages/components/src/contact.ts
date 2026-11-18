// Contact form fields (Phase 44). The same rules run in the visitor's browser
// (site.js) and in the site Worker, which is the boundary that decides. The
// form posts to its own portfolio origin; the recipient never reaches it.

export const CONTACT_SOURCE_PATH = "/_/contact";
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_SCRIPT = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
export const CONTACT_LIMITS = {
  name: 100,
  email: 254,
  message: 5000,
  token: 2048,
} as const;

export type ContactField = "name" | "email" | "message";
export type FieldError = "required" | "invalid" | "too_long";
export type ContactFields = Record<ContactField, string>;
export type FieldErrors = Partial<Record<ContactField, FieldError>>;

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const controls = (value: string, allowNewlines: boolean) =>
  [...value].some((char) => {
    const code = char.charCodeAt(0);
    if (allowNewlines && (char === "\n" || char === "\r" || char === "\t"))
      return false;
    return code < 0x20 || code === 0x7f;
  });
// The visitor's address becomes Reply-To, so it must be one plain address.
const ADDRESS =
  /^[^\s<>@,;"()[\]\\]+@[^\s<>@,;"()[\]\\]+\.[^\s<>@,;"()[\]\\]+$/;

/** Trimmed field values and the first problem with each, if any. */
export function checkContactFields(input: ContactFields): {
  values: ContactFields;
  errors: FieldErrors;
} {
  const values = {
    name: input.name.trim(),
    email: input.email.trim(),
    message: input.message.trim(),
  };
  const errors: FieldErrors = {};
  if (!values.name) errors.name = "required";
  else if ([...values.name].length > CONTACT_LIMITS.name)
    errors.name = "too_long";
  else if (controls(values.name, false)) errors.name = "invalid";
  if (!values.email) errors.email = "required";
  else if (bytes(values.email) > CONTACT_LIMITS.email)
    errors.email = "too_long";
  else if (!ADDRESS.test(values.email) || controls(values.email, false))
    errors.email = "invalid";
  if (!values.message) errors.message = "required";
  else if ([...values.message].length > CONTACT_LIMITS.message)
    errors.message = "too_long";
  else if (controls(values.message, true)) errors.message = "invalid";
  return { values, errors };
}

export const FIELD_MESSAGES: Record<
  ContactField,
  Record<FieldError, string>
> = {
  name: {
    required: "Enter your name.",
    invalid: "Remove unsupported characters from your name.",
    too_long: `Use ${CONTACT_LIMITS.name} characters or fewer.`,
  },
  email: {
    required: "Enter your email address.",
    invalid: "Enter a valid email address, like name@example.com.",
    too_long: "Use a shorter email address.",
  },
  message: {
    required: "Enter a message.",
    invalid: "Remove unsupported characters from your message.",
    too_long: `Use ${CONTACT_LIMITS.message} characters or fewer.`,
  },
};

// Closed response codes from `/_/contact`. Only 202 `accepted` is success.
export type ContactResponse =
  | { status: "accepted" }
  | { error: "invalid_fields"; fields: FieldErrors }
  | {
      error:
        | "invalid_request"
        | "blocked"
        | "limited"
        | "unavailable"
        | "failed";
    };
