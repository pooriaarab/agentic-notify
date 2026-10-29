export { VERSION } from "./version.js";

export const PACKAGE_NAME = "agentic-notify";

export { createNotifier, NotFoundError } from "./core/service.js";
export type { Notifier, NotifierOptions, SendResult, ListOptions, ListResult } from "./core/service.js";
export { MemoryStore } from "./core/store.js";
export type { Store, Query, Page, Doc, Scalar } from "./core/store.js";
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
export { createEmailChannel, TestEmailAdapter } from "./delivery/email.js";
export type { EmailMessage, EmailPort, EmailChannelOptions } from "./delivery/email.js";
export { DeliveryError } from "./delivery/types.js";
export type { DeliveryChannel, Logger } from "./delivery/types.js";
