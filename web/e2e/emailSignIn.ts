import { expect, request, type Page } from "@playwright/test";

/**
 * Signing in the way a person does on the local stack: the emailed
 * link, from the inbox docker-compose.yml runs beside the webapp
 * (Mailpit, its API on port 8025). MAILPIT_URL overrides where that
 * is; MAILPIT_UI_AUTH, `user:password`, is the password
 * docker-compose.phone.yml puts on it.
 */

/** The address the suite runs as, a developer on the local stack
 *  whatever .env lists (docker-compose.yml's APP_DEVELOPER_EMAILS). */
export const DEVELOPER = "developer@example.com";
/** That developer's session, written by auth.setup.ts and opened by
 *  every test that does not say otherwise (playwright.config.ts). */
export const DEVELOPER_STATE = "e2e/.auth/developer.json";

const auth = process.env.MAILPIT_UI_AUTH;

async function inbox() {
  return request.newContext({
    baseURL: process.env.MAILPIT_URL ?? "http://localhost:8025",
    extraHTTPHeaders: auth ? { Authorization: `Basic ${Buffer.from(auth).toString("base64")}` } : {},
  });
}

async function messagesTo(address: string): Promise<string[]> {
  const mail = await inbox();
  const res = await mail.get("/api/v1/search", { params: { query: `to:"${address}"` } });
  expect(res.ok(), `the inbox answered ${res.status()}`).toBe(true);
  const { messages } = await res.json() as { messages: { ID: string }[] };
  await mail.dispose();
  return messages.map(m => m.ID);
}

async function linkIn(id: string): Promise<URL> {
  const mail = await inbox();
  const { Text } = await (await mail.get(`/api/v1/message/${id}`)).json() as { Text: string };
  await mail.dispose();
  const link = Text.match(/\S+\/api\/auth\/magic-link\/verify\?token=\S+/)?.[0];
  if (!link) throw new Error(`no sign-in link in message ${id}: ${Text}`);
  return new URL(link);
}

/**
 * Asks for a link for `address` from the pilot console, opening it
 * first if it is not already, then opens the link from the inbox and
 * presses Sign in in the planner's dialog it lands on. The link
 * points at APP_PUBLIC_BASE_URL; it is opened at the address this run
 * is testing instead, so the session lands in this browser.
 *
 * One test at a time per address: two asking at once would each read
 * whichever link came in first.
 */
export async function signInByEmail(page: Page, address: string) {
  await openLinkFor(page, address);
  await page.getByRole("dialog").getByRole("button", { name: "Sign in" }).click();
}

/** Asks for a link for `address` and opens it: the planner, with its
 *  sign-in dialog up. Answers the link, to open again. */
export async function openLinkFor(page: Page, address: string): Promise<string> {
  const console = page.locator('[data-slot="sheet-content"][data-side="top"]');
  const before = new Set(await messagesTo(address));
  if (!(await console.isVisible())) await page.getByTestId("pilot-button").click();
  await console.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Email address").fill(address);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(page.getByRole("status")).toContainText(`Check ${address}`);

  let id: string | undefined;
  await expect.poll(async () => (id = (await messagesTo(address)).find(m => !before.has(m))),
    { message: `a sign-in email to ${address}` }).toBeTruthy();
  const link = await linkIn(id!);
  const path = link.pathname + link.search;
  await page.goto(path);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Sign in" })).toBeVisible();
  return path;
}
