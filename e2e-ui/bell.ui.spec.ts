import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { ANA, BOT } from "./keys.js";

// Screenshots go to test-results. Set SCREENSHOTS=docs/screenshots to refresh the committed ones.
const SHOTS = process.env.SCREENSHOTS ?? "test-results/screenshots";
const SCHEMES = ["light", "dark"] as const;

// Every view is checked in both color schemes: an axe WCAG 2.2 AA scan, then a screenshot for review.
async function audit(page: Page, view: string) {
  mkdirSync(SHOTS, { recursive: true });
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `${view} (${scheme})`).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/${view}-${scheme}.png` });
  }
}

const send = (page: Page, token: string, body: string, url?: string) =>
  page.request.post("/api/v1/notifications", {
    headers: { authorization: `Bearer ${token}` },
    data: { recipient: { kind: "human", id: "ana" }, type: "build.done", resource: { kind: "build", id: "7", ...(url ? { url } : {}) }, body },
  });

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("bell: sign in, live update, read one, read all, keyboard, phone width", async ({ page }) => {
  const csp: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/.test(m.text()) && csp.push(m.text()));

  await page.goto("/ui/");
  await audit(page, "01-sign-in");
  await page.getByLabel("API token").fill("not-the-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("The token was not accepted");
  await page.getByLabel("API token").fill(ANA);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Empty inbox.
  const bell = page.getByRole("button", { name: "Notifications", exact: true });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByText("You are all caught up")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  await audit(page, "02-empty");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(bell).toBeFocused();

  // Live update: an agent sends two notifications. The bell picks them up without a reload.
  expect((await send(page, BOT, "Build 7 finished", "https://example.com/builds/7")).status()).toBe(201);
  expect((await send(page, BOT, "Build 8 failed")).status()).toBe(201);
  const unreadBell = page.getByRole("button", { name: "Notifications, 2 unread" });
  await expect(unreadBell).toBeVisible({ timeout: 15_000 });

  // Keyboard: Enter opens the popover and moves focus into it.
  await unreadBell.focus();
  await page.keyboard.press("Enter");
  await expect(panel).toBeFocused();
  const items = panel.getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.first().getByText("Sent by an agent")).toBeVisible();
  await expect(panel.getByRole("link", { name: /View/ })).toHaveAttribute("href", "https://example.com/builds/7");
  await audit(page, "03-inbox");

  // Mark one read.
  await panel.getByRole("button", { name: "Mark read: Build 7 finished" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Notifications, 1 unread" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Mark read:/ })).toHaveCount(1);
  // The focused button is gone: focus stays in the popover, so Escape still closes it.
  await expect(panel.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Notifications, 1 unread" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel).toBeFocused();

  // Mark all read.
  await panel.getByRole("button", { name: "Mark all read" }).click();
  await expect(bell).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Mark read:/ })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Mark all read" })).toBeDisabled();

  // A click outside closes it.
  await page.getByRole("heading", { name: "Send a notification" }).click();
  await expect(panel).toBeHidden();

  // Send to yourself from the form: it shows up.
  await page.getByLabel("Recipient id").fill("ana");
  await page.getByLabel("Message").fill("Hello from the form");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Sent." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Notifications, 1 unread" })).toBeVisible({ timeout: 15_000 });

  // Phone width: the popover stays inside the screen and the page does not scroll sideways.
  await page.setViewportSize({ width: 390, height: 780 });
  await page.getByRole("button", { name: "Notifications, 1 unread" }).click();
  await expect(panel.getByText("Hello from the form")).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await noOverflow(page)).toBe(true);
  await audit(page, "04-inbox-390");

  expect(csp).toEqual([]);
});

test("bell: a refused token shows an alert, not an empty inbox", async ({ page }) => {
  await page.goto("/ui/");
  await page.evaluate((t) => sessionStorage.setItem("notify-demo-token", t), "revoked-token-0123456789-0123456789-0123");
  await page.reload();
  // A failed load is not "nothing unread": the bell says so before it is opened.
  const failed = page.getByRole("button", { name: "Notifications, could not load" });
  await expect(failed).toBeVisible();
  await failed.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByRole("alert")).toContainText("The token was not accepted");
  await expect(panel.getByText("You are all caught up")).toHaveCount(0);
});

test("phone: the sign-in and send views fit 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/ui/");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  expect(await noOverflow(page)).toBe(true);
  await audit(page, "05-sign-in-390");
  await page.getByLabel("API token").fill(ANA);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Send a notification" })).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await audit(page, "06-send-390");
});
