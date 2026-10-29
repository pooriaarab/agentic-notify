import { z } from "zod";

export const CHANNELS = ["inbox", "webhook", "email"] as const;
export type Channel = (typeof CHANNELS)[number];

const id = z.string().min(1).max(200);

export const recipientSchema = z
  .object({ kind: z.enum(["human", "agent"]), id })
  .strict();
export type Recipient = z.infer<typeof recipientSchema>;

export const typeNameSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);

export const resourceRefSchema = z
  .object({
    kind: z.string().min(1).max(100),
    id,
    url: z
      .string()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u) && URL.canParse(u), "url must be http or https")
      .optional(),
  })
  .strict();
export type ResourceRef = z.infer<typeof resourceRefSchema>;

export const actorSchema = z
  .object({ kind: z.enum(["human", "agent"]), id })
  .strict();
export type Actor = z.infer<typeof actorSchema>;

export const notificationSchema = z
  .object({
    id,
    recipient: recipientSchema,
    type: typeNameSchema,
    resource: resourceRefSchema,
    actor: actorSchema,
    body: z.string().max(2000),
    createdAt: z.number().int().nonnegative(),
    readAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type Notification = z.infer<typeof notificationSchema>;

export const sendInputSchema = z
  .object({
    recipient: recipientSchema,
    type: typeNameSchema,
    resource: resourceRefSchema,
    actor: actorSchema,
    body: z.string().max(2000),
  })
  .strict();
export type SendInput = z.infer<typeof sendInputSchema>;

export const preferencesSchema = z
  .object({
    channels: z.record(typeNameSchema, z
        .array(z.enum(CHANNELS))
        .max(CHANNELS.length)
        .refine((list) => new Set(list).size === list.length, "channels must not repeat")),
    muted: z.boolean(),
    mutedTypes: z.array(typeNameSchema).max(200),
  })
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_CHANNELS: readonly Channel[] = ["inbox"];

export function defaultPreferences(): Preferences {
  return { channels: {}, muted: false, mutedTypes: [] };
}

export function recipientKey(recipient: Recipient): string {
  return `${recipient.kind}:${recipient.id}`;
}

export interface DigestGroup {
  type: string;
  count: number;
  latest: Notification;
}

export interface Digest {
  total: number;
  groups: DigestGroup[];
}
