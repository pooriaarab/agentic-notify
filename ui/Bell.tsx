import { useEffect, useId, useRef, useState } from "react";
import { IconButton } from "agentic-design/react";
import { Inbox } from "./Inbox.js";
import { useNotifications, type NotifyUiOptions } from "./useNotifications.js";

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/**
 * A bell button with the unread count. It opens a popover with the inbox: mark one or all read,
 * an empty state, and a live refresh. Escape, a click outside, or Tab out closes it.
 */
export function NotificationBell(options: NotifyUiOptions) {
  const state = useNotifications(options);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const headingId = useId();
  const { unread } = state;

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onPointer = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  return (
    <div
      ref={root}
      className="agd-notify"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          close(true);
        }
      }}
      onBlur={(e) => open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node) && setOpen(false)}
    >
      <span className="agd-notify__trigger">
        <IconButton
          ref={button}
          variant="ghost"
          label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          tooltip={false}
          icon={<BellIcon />}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => {
            setOpen((o) => !o);
            if (!open) void state.refresh();
          }}
        />
        {unread > 0 && (
          <span className="agd-notify__count" aria-hidden="true">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </span>
      <span className="agd-sr-only" role="status">
        {unread > 0 ? `${unread} unread notifications` : "No unread notifications"}
      </span>
      {open && (
        <div ref={panel} id={panelId} className="agd-notify__panel" role="dialog" aria-labelledby={headingId} tabIndex={-1}>
          <Inbox state={state} headingId={headingId} />
        </div>
      )}
    </div>
  );
}
