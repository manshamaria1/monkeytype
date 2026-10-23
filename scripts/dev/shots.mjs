// Dev helper: screenshots of the main pages for visual review (not part of the test suite).
import { chromium, devices } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3000";
const out = process.env.OUT ?? "/tmp/shots";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
const words = () => p.$$eval('[data-testid="words"] .word', (els) => els.map((e) => Array.from(e.querySelectorAll(".letter:not(.extra)")).map((l) => l.firstChild?.textContent ?? "").join("")));
await p.goto(base + "/account/register");
await p.getByLabel("Username").fill("visual_check");
await p.getByLabel("Email").fill("visual@example.com");
await p.getByLabel("Password (8+ characters)").fill("password123");
await p.getByLabel("Confirm password").fill("password123");
await p.getByRole("button", { name: "create account" }).click();
await p.waitForURL(base + "/");
await p.screenshot({ path: `${out}/01-home.png` });
for (let i = 0; i < 3; i++) {
  await p.getByRole("group", { name: "Test mode" }).getByRole("button", { name: "words" }).click();
  await p.getByRole("group", { name: "Number of words" }).getByRole("button", { name: "10", exact: true }).click();
  await p.locator('[data-testid="typing-input"]').focus();
  const w = await words();
  for (let j = 0; j < w.length; j++) {
    await p.keyboard.type(w[j], { delay: 50 + i * 20 });
    if (j === 3) await p.keyboard.type("x", { delay: 50 });
    if (j < w.length - 1) await p.keyboard.press("Space");
  }
  await p.getByTestId("results").waitFor();
  await p.waitForTimeout(600);
  if (i === 2) await p.screenshot({ path: `${out}/02-results.png` });
  await p.keyboard.press("Tab");
}
for (const [name, path] of [["03-leaderboard", "/leaderboard?mode=words&mode2=10"], ["04-stats", "/stats"], ["05-settings", "/settings"], ["06-practice", "/practice"], ["07-multiplayer", "/multiplayer"], ["08-profile", "/profile"], ["09-about", "/about"], ["10-lesson", "/practice/lesson/home-row"]]) {
  await p.goto(base + path);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/${name}.png`, fullPage: name !== "05-settings" });
}
await p.goto(base + "/settings");
await p.getByRole("button", { name: "Classic light" }).click();
await p.goto(base + "/");
await p.locator('[data-testid="typing-input"]').focus();
await p.keyboard.type("the quick", { delay: 40 });
await p.screenshot({ path: `${out}/11-light-typing.png` });
const m = await b.newContext({ ...devices["Pixel 7"] });
const mp = await m.newPage();
await mp.goto(base + "/");
await mp.screenshot({ path: `${out}/12-mobile.png` });
await mp.goto(base + "/leaderboard?mode=words&mode2=10");
await mp.waitForTimeout(500);
await mp.screenshot({ path: `${out}/13-mobile-lb.png` });
console.log("errors:", errs);
await b.close();
