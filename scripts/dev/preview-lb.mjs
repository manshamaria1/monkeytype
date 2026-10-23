// Dev helper: checks the server-only pages in the preview build show the preview notice.
import { chromium } from "@playwright/test";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto("file://" + process.argv[2]);
for (const name of [/leaderboard/, /multiplayer/, /sign in/, /stats/]) {
  await p.getByRole("link", { name }).first().click();
  await p.waitForTimeout(300);
  console.log(name, "->", (await p.locator("main").innerText()).split("\n").slice(0, 2).join(" | "));
}
console.log("errors:", errs);
await b.close();
