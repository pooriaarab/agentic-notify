// The notifications UI for an app that embeds it: `agentic-notify/ui`. Import `agentic-notify/ui.css` and the
// design stylesheet `agentic-design/styles.css` too. React is a peer dependency.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "agentic-design/react";
import "./app.css";
import { NotificationBell } from "./Bell.js";
import { checkOptions, type NotifyUiOptions } from "./useNotifications.js";

export { NotificationBell } from "./Bell.js";
export { Inbox } from "./Inbox.js";
export { useNotifications, type NotifyUiOptions, type NotificationsState } from "./useNotifications.js";

export interface MountedBell {
  /** Point the bell at another Worker or token callback. A bad option throws and keeps the bell as it is. */
  update(options: NotifyUiOptions): void;
  /** Remove the bell. */
  unmount(): void;
}

/** Render the bell into an element, for an app that does not use React itself. It does not set the page theme: the tokens follow the page's `data-theme` or the system setting. */
export function mount(element: HTMLElement, options: NotifyUiOptions): MountedBell {
  if (!(element instanceof HTMLElement)) throw new TypeError("mount needs an element to render into");
  checkOptions(options);
  const root = createRoot(element);
  const render = (next: NotifyUiOptions) =>
    root.render(
      <StrictMode>
        <TooltipProvider>
          <NotificationBell key={next.baseUrl} {...next} />
        </TooltipProvider>
      </StrictMode>,
    );
  render(options);
  return { update: (next) => (checkOptions(next), render(next)), unmount: () => root.unmount() };
}
