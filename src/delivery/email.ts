import type { Notification, Recipient } from "../core/types.js";
import type { DeliveryChannel } from "./types.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Port for a mail provider. Real adapters live outside this package. */
export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}

/** Test adapter. Keeps sent messages in memory. */
export class TestEmailAdapter implements EmailPort {
  readonly sent: EmailMessage[] = [];
  failNext = 0;

  async send(message: EmailMessage): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("test adapter forced failure");
    }
    this.sent.push({ ...message });
  }
}

export interface EmailChannelOptions {
  port: EmailPort;
  /** Find the address for a recipient. Return null when none is set. */
  resolveAddress(recipient: Recipient): Promise<string | null> | string | null;
}

export function createEmailChannel(options: EmailChannelOptions): DeliveryChannel {
  return {
    async deliver(n: Notification) {
      const to = await options.resolveAddress(n.recipient);
      if (!to) return;
      // Strip line breaks so content cannot inject mail headers.
      const subject = `${n.type.replace(/[_.-]+/g, " ")}: ${n.resource.kind} ${n.resource.id}`.replace(/[\r\n]+/g, " ");
      await options.port.send({ to, subject, text: n.body });
    },
  };
}
