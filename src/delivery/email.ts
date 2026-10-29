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

const CONTROL = /[\x00-\x1f\x7f]/;
const CONTROL_G = /[\x00-\x1f\x7f]+/g;

export interface EmailChannelOptions {
  port: EmailPort;
  /** Find the address for a recipient. Return null when none is set. */
  resolveAddress(recipient: Recipient): Promise<string | null> | string | null;
}

export function createEmailChannel(options: EmailChannelOptions): DeliveryChannel {
  return {
    async deliver(n: Notification) {
      const to = await options.resolveAddress(n.recipient);
      if (!to) return "skipped";
      // Control characters in an address or subject could inject mail headers.
      if (CONTROL.test(to)) throw new Error("address holds control characters");
      const subject = `${n.type.replace(/[_.-]+/g, " ")}: ${n.resource.kind} ${n.resource.id}`.replace(CONTROL_G, " ");
      await options.port.send({ to, subject, text: n.body });
      return "sent";
    },
  };
}
