import { z } from "zod";

export const githubSchema = z.strictObject({
  username: z.union([
    z.literal(""),
    z.string().regex(/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i),
  ]),
  includePrivate: z.boolean(),
});
