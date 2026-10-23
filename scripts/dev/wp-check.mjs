// Dev helper: drives the typing test on a local WordPress page.
import { chromium } from "@playwright/test";
const base = process.env.WP_URL ?? "http://localhost:8080";
const page = process.env.WP_PAGE ?? "/?page_id=5";
const out = process.env.OUT ?? "/tmp";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text()));
const words = () => p.$$eval('[data-testid="words"] .word', (els) => els.map((e) => Array.from(e.querySelectorAll(".letter:not(.extra)")).map((l) => l.firstChild?.textContent ?? "").join("")));
async function typeTest(delay = 60) {
  await p.getByRole("group", { name: "Test mode" }).getByRole("button", { name: "words" }).click();
  await p.getByRole("group", { name: "Number of words" }).getByRole("button", { name: "10", exact: true }).click();
  await p.locator('[data-testid="typing-input"]').focus();
  const w = await words();
  for (let i = 0; i < w.length; i++) { await p.keyboard.type(w[i], { delay }); if (i < w.length - 1) await p.keyboard.press("Space"); }
  await p.getByTestId("results").waitFor({ timeout: 8000 });
  await p.waitForTimeout(1200);
  return { wpm: await p.getByTestId("result-wpm").textContent(), save: await p.getByTestId("save-status").textContent() };
}
await p.goto(base + page);
await p.waitForSelector('[data-testid="words"] .word');
await p.screenshot({ path: `${out}/wp-guest.png` });
console.log("guest:", await typeTest());
// sign in through WordPress
await p.goto(`${base}/wp-login.php`);
await p.fill("#user_login", "alice");
await p.fill("#user_pass", "alicepass123");
await p.click("#wp-submit");
await p.waitForLoadState();
await p.goto(base + page);
await p.waitForSelector('[data-testid="words"] .word');
console.log("alice:", await typeTest());
await p.screenshot({ path: `${out}/wp-results.png` });
for (const [name, hash] of [["lb", "#/leaderboard?mode=words&mode2=10"], ["stats", "#/stats"], ["profile", "#/profile"], ["mp", "#/multiplayer"]]) {
  await p.goto(base + page + hash);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/wp-${name}.png`, fullPage: true });
}
console.log("leaderboard text:", (await p.goto(base + page + "#/leaderboard?mode=words&mode2=10"), await p.waitForTimeout(1000), (await p.locator('[data-testid="leaderboard-table"]').innerText().catch(() => "NO TABLE")).replace(/\s+/g, " ").slice(0, 200)));
console.log("errors:", errs);
await b.close();
