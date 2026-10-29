import { useEffect, useId, useRef, useState } from "react";
import { BotIcon, Button } from "agentic-design/react";
import type { Notification } from "../src/core/types.js";
import type { NotificationsState } from "./useNotifications.js";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "5 minutes ago". Anything under a minute is "just now". */
export function ago(createdAt: number, now = Date.now()): string {
  const diff = createdAt - now;
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(diff / size), unit);
  }
  return "just now";
}

/** Only web links open. The server checks the same, and a value that is not a URL never becomes a link. */
function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** A short form of the body for a control name, so a screen reader does not read 2000 characters. */
const brief = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);

function Item({ n, busy, now, onRead }: { n: Notification; busy: boolean; now: number; onRead(id: string): void }) {
  const unread = n.readAt === null;
  const href = safeHref(n.resource.url);
  return (
    <li className="agd-notify__item" data-unread={unread || undefined}>
      <div className="agd-notify__main">
        <p className="agd-notify__body">
          {unread && <span className="agd-sr-only">Unread. </span>}
          {n.body}
        </p>
        {n.actor.kind === "agent" && (
          <div className="agd-notify__agent">
            <span className="agd-notify__agent-mark">
              <BotIcon width={14} height={14} aria-hidden="true" />
              Sent by an agent
            </span>
            <span className="agd-notify__actor">{n.actor.id}</span>
          </div>
        )}
        <p className="agd-notify__meta">
          <span>{n.type}</span>
          <time dateTime={new Date(n.createdAt).toISOString()} title={new Date(n.createdAt).toLocaleString()}>
            {ago(n.createdAt, now)}
          </time>
        </p>
      </div>
      <div className="agd-notify__actions">
        {href && (
          <a className="agd-notify__link" href={href} rel="noopener noreferrer">
            View<span className="agd-sr-only"> {n.resource.kind}: {brief(n.body)}</span>
          </a>
        )}
        {unread && (
          <Button size="sm" variant="ghost" aria-disabled={busy || undefined} aria-label={`Mark read: ${brief(n.body)}`} onClick={() => !busy && onRead(n.id)}>
            Mark read
          </Button>
        )}
      </div>
    </li>
  );
}

/** The list, the header actions, and the empty and error states. The bell puts this in a popover. */
export function Inbox({ state, headingId, keepFocus = false }: { state: NotificationsState; headingId?: string; /** Move focus into the inbox when a mark call removes the focused button. The bell sets it. Off by default, so a poll never moves focus on a page. */ keepFocus?: boolean }) {
  const ownId = useId();
  const box = useRef<HTMLDivElement>(null);
  // The times move on while the popover stays open.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  headingId ??= ownId;
  const { items, unread, loading, error, actionError, busy, markRead, markAllRead } = state;
  // After a mark call the focused control can vanish. Keep focus in the inbox, so Tab and Escape still work.
  useEffect(() => {
    if (keepFocus && document.activeElement === document.body) box.current?.focus({ preventScroll: true });
  }, [items, busy, keepFocus]);
  return (
    <div ref={box} className="agd-notify__inbox" tabIndex={-1}>
      <div className="agd-notify__head">
        <h2 id={headingId} className="agd-notify__title">
          Notifications
        </h2>
        <Button size="sm" variant="secondary" disabled={unread === 0} aria-disabled={busy || undefined} onClick={() => !busy && void markAllRead()}>
          Mark all read
        </Button>
      </div>
      {error && (
        <p role="alert" className="agd-notify__error">
          {error}{" "}
          <button type="button" className="agd-notify__retry" onClick={() => void state.refresh()}>
            Try again
          </button>
        </p>
      )}
      {actionError && (
        <p role="alert" className="agd-notify__error">
          {actionError}{" "}
          <button type="button" className="agd-notify__retry" onClick={state.dismissError}>
            Dismiss
          </button>
        </p>
      )}
      {loading ? (
        <p className="agd-notify__loading" role="status">
          Loading notifications…
        </p>
      ) : items.length === 0 ? (
        !error && (
          <div className="agd-empty">
            <p className="agd-empty__title">You are all caught up</p>
            <p className="agd-empty__description">New notifications show here.</p>
          </div>
        )
      ) : (
        <ul className="agd-notify__list" aria-labelledby={headingId}>
          {items.map((n) => (
            <Item key={n.id} n={n} busy={busy} now={now} onRead={(id) => void markRead(id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
