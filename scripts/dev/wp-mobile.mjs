// Dev helper: mobile screenshot of the WordPress typing test page.
import { chromium, devices } from "@playwright/test";
const base = process.env.WP_URL ?? "http://localhost:8080";
const page = process.env.WP_PAGE ?? "/?page_id=5";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const p = await ctx.newPage();
await p.goto(base + page);
await p.waitForSelector('[data-testid="words"] .word');
await p.locator("#typing-test-root").scrollIntoViewIfNeeded();
await p.screenshot({ path: (process.env.OUT ?? "/tmp") + "/wp-mobile.png" });
await b.close();
