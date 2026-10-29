import { BotIcon, Button, EmptyState } from "agentic-design/react";
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
  if (!url || !URL.canParse(url)) return undefined;
  const { protocol } = new URL(url);
  return protocol === "https:" || protocol === "http:" ? url : undefined;
}

function Item({ n, busy, onRead }: { n: Notification; busy: boolean; onRead(id: string): void }) {
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
            {ago(n.createdAt)}
          </time>
        </p>
      </div>
      <div className="agd-notify__actions">
        {href && (
          <a className="agd-notify__link" href={href} rel="noopener noreferrer">
            View<span className="agd-sr-only"> {n.resource.kind}: {n.body}</span>
          </a>
        )}
        {unread && (
          <Button size="sm" variant="ghost" aria-disabled={busy || undefined} aria-label={`Mark read: ${n.body}`} onClick={() => !busy && onRead(n.id)}>
            Mark read
          </Button>
        )}
      </div>
    </li>
  );
}

/** The list, the header actions, and the empty and error states. The bell puts this in a popover. */
export function Inbox({ state, headingId }: { state: NotificationsState; headingId: string }) {
  const { items, unread, loading, error, actionError, busy, markRead, markAllRead } = state;
  return (
    <div className="agd-notify__inbox">
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
          {actionError}
        </p>
      )}
      {loading ? (
        <p className="agd-notify__loading" role="status">
          Loading notifications…
        </p>
      ) : items.length === 0 ? (
        !error && <EmptyState title="You are all caught up" description="New notifications show here." />
      ) : (
        <ul className="agd-notify__list" aria-labelledby={headingId}>
          {items.map((n) => (
            <Item key={n.id} n={n} busy={busy} onRead={(id) => void markRead(id)} />
          ))}
        </ul>
      )}
    </div>
  );
}
