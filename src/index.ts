export { VERSION } from "./version.js";

export const PACKAGE_NAME = "agentic-notify";

export { createNotifier, NotFoundError } from "./core/service.js";
export type { Notifier, NotifierOptions, SendResult, ListOptions, ListResult } from "./core/service.js";
export { createMemoryStore } from "agentic-identity";
export type { Store, StoreOps, Query, Page, Doc, Scalar } from "agentic-identity";
export { CHANNELS, DEFAULT_CHANNELS, defaultPreferences, recipientKey } from "./core/types.js";
export type {
  Actor,
  Channel,
  Digest,
  DigestGroup,
  Notification,
  Preferences,
  Recipient,
  ResourceRef,
  SendInput,
} from "./core/types.js";
export { createDispatcher } from "./delivery/dispatch.js";
export type { DispatchResult, DispatcherOptions } from "./delivery/dispatch.js";
export { createWebhookChannel, signPayload, verifySignature, SIGNATURE_HEADER } from "./delivery/webhook.js";
export type { WebhookOptions, WebhookTarget } from "./delivery/webhook.js";
export { createEmailChannel } from "./delivery/email.js";
export type { EmailMessage, EmailPort, EmailChannelOptions } from "./delivery/email.js";
export { DeliveryError } from "./delivery/types.js";
export type { DeliveryChannel, Logger } from "./delivery/types.js";
export { createD1Store, D1_SCHEMA } from "agentic-identity/cloudflare";
export type { D1Like } from "agentic-identity/cloudflare";
export type { RecipientExport } from "./core/gdpr.js";
export { notifyAccount } from "./account.js";
export type { NotifyAccount, NotifyAccountDeps, Subject as AccountSubject } from "./account.js";
