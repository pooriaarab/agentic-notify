import type { Notification } from "../core/types.js";

/** A delivery channel other than the inbox. */
export interface DeliveryChannel {
  deliver(notification: Notification): Promise<void>;
}

export class DeliveryError extends Error {
  readonly code = "DELIVERY_FAILED";
  constructor(message: string, readonly attempts: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DeliveryError";
  }
}

/** Logger that takes ids and counts only. Never pass content or addresses. */
export interface Logger {
  warn(message: string, fields?: Record<string, string | number>): void;
}
