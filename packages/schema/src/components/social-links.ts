import { z } from "zod";

// Entries and placement booleans live in Draft.links, never in a second array.
export const socialLinksSchema = z.strictObject({});
