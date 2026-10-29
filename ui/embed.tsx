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

/** The options of `mount`: the hook options plus the bell's `align`. */
export type MountOptions = NotifyUiOptions & { /** Which edge of the bell the popover lines up with. Default "end". */ align?: "start" | "end" };

export interface MountedBell {
  /** Point the bell at another Worker or token callback. A bad option throws and keeps the bell as it is. */
  update(options: MountOptions): void;
  /** Remove the bell. */
  unmount(): void;
}

/** Render the bell into an element, for an app that does not use React itself. It does not set the page theme: the tokens follow the page's `data-theme` or the system setting. */
export function mount(element: HTMLElement, options: MountOptions): MountedBell {
  if (!(element instanceof HTMLElement)) throw new TypeError("mount needs an element to render into");
  checkOptions(options);
  const root = createRoot(element);
  // A new key on each update remounts the bell, so one caller's list never shows under another's token.
  let generation = 0;
  let gone = false;
  const render = (next: MountOptions) =>
    root.render(
      <StrictMode>
        <TooltipProvider>
          <NotificationBell key={generation} {...next} />
        </TooltipProvider>
      </StrictMode>,
    );
  render(options);
  return {
    update: (next: MountOptions) => {
      if (gone) throw new TypeError("the bell was unmounted: mount it again");
      checkOptions(next);
      generation++;
      render(next);
    },
    unmount: () => {
      gone = true;
      root.unmount();
    },
  };
}
