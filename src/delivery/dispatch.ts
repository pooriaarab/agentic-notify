import type { Notifier } from "../core/service.js";
import type { Channel, Notification, SendInput } from "../core/types.js";
import type { DeliveryChannel, Logger } from "./types.js";

export interface DispatchResult {
  notification: Notification | null;
  stored: boolean;
  muted: boolean;
  deliveries: { channel: Channel; ok: boolean; error?: string }[];
}

export interface DispatcherOptions {
  notifier: Notifier;
  /** Channels other than the inbox. A channel with no entry is skipped. */
  channels: Partial<Record<Exclude<Channel, "inbox">, DeliveryChannel>>;
  logger?: Logger;
}

export function createDispatcher(options: DispatcherOptions) {
  return {
    /** Store in the inbox, then try each other channel the recipient chose. One failure never blocks the rest. */
    async notify(input: SendInput): Promise<DispatchResult> {
      const sent = await options.notifier.send(input);
      const deliveries: DispatchResult["deliveries"] = [];
      const notification = sent.notification;
      if (notification) {
        for (const channel of sent.channels) {
          if (channel === "inbox") continue;
          const impl = options.channels[channel];
          if (!impl) continue;
          try {
            await impl.deliver(notification);
            deliveries.push({ channel, ok: true });
          } catch (error) {
            const name = error instanceof Error ? error.name : "Error";
            deliveries.push({ channel, ok: false, error: name });
            options.logger?.warn("delivery failed", { id: notification.id, channel, error: name });
          }
        }
      }
      return { notification, stored: sent.stored, muted: sent.muted, deliveries };
    },
  };
}
