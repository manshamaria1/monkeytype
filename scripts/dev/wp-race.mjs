// Dev helper: two signed-in WordPress users race each other through the plugin.
import { chromium } from "@playwright/test";
const base = process.env.WP_URL ?? "http://localhost:8080";
const page = process.env.WP_PAGE ?? "/?page_id=5";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errs = [];
async function login(user, pass) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errs.push(user + ": " + e.message));
  if (process.env.DEBUG) p.on("response", (r) => r.url().includes("typing-test/v1/mp") && console.log(user, r.status(), r.url().split("rest_route=")[1]));
  await p.goto(`${base}/wp-login.php`);
  await p.fill("#user_login", user);
  await p.fill("#user_pass", pass);
  await p.click("#wp-submit");
  await p.waitForLoadState();
  return p;
}
const words = (p) => p.$$eval('[data-testid="words"] .word', (els) => els.map((e) => Array.from(e.querySelectorAll(".letter:not(.extra)")).map((l) => l.firstChild?.textContent ?? "").join("")));
const typeAll = async (p, w, delay) => { for (let i = 0; i < w.length; i++) { await p.keyboard.type(w[i], { delay }); if (i < w.length - 1) await p.keyboard.press("Space"); } };
const alice = await login("alice", "alicepass123");
const bob = await login("bob", "bobpass12345");
await alice.goto(base + page + "#/multiplayer");
await alice.getByTestId("create-room").click();
const code = (await alice.getByTestId("room-code").textContent({ timeout: 10000 })).trim();
console.log("room", code);
// Bob opens the invite link.
await bob.goto(base + page + "#/multiplayer/" + code);
await bob.getByTestId("ready").click({ timeout: 10000 });
await alice.getByText("ready", { exact: true }).waitFor({ timeout: 10000 });
await alice.getByTestId("start-race").click();
await alice.getByTestId("countdown").waitFor({ timeout: 10000 });
await alice.getByTestId("countdown").waitFor({ state: "hidden", timeout: 10000 });
await bob.getByTestId("countdown").waitFor({ state: "hidden", timeout: 10000 });
const w = await words(alice);
console.log("same text:", JSON.stringify(w) === JSON.stringify(await words(bob)), w.length, "words");
await alice.locator('[data-testid="typing-input"]').focus();
await typeAll(alice, w, 60);
await bob.locator('[data-testid="typing-input"]').focus();
await typeAll(bob, w, 90);
await alice.getByTestId("race-results").waitFor({ timeout: 20000 });
await bob.getByTestId("race-results").waitFor({ timeout: 20000 });
console.log("alice:", (await alice.getByTestId("race-results").innerText()).split("\n")[0]);
console.log("bob:", (await bob.getByTestId("race-results").innerText()).split("\n")[0]);
await alice.screenshot({ path: (process.env.OUT ?? "/tmp") + "/wp-race.png", fullPage: true });
console.log("errors:", errs);
await b.close();
