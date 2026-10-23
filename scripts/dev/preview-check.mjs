// Dev helper: types one test in the self-contained preview page.
import { chromium } from "@playwright/test";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
await p.goto("file://" + process.argv[2]);
await p.getByRole("group", { name: "Test mode" }).getByRole("button", { name: "words" }).click();
await p.getByRole("group", { name: "Number of words" }).getByRole("button", { name: "10", exact: true }).click();
await p.locator('[data-testid="typing-input"]').focus();
const words = await p.$$eval('[data-testid="words"] .word', (els) => els.map((e) => Array.from(e.querySelectorAll(".letter:not(.extra)")).map((l) => l.firstChild?.textContent ?? "").join("")));
for (let i = 0; i < words.length; i++) { await p.keyboard.type(words[i], { delay: 30 }); if (i < words.length - 1) await p.keyboard.press("Space"); }
await p.getByTestId("results").waitFor({ timeout: 5000 });
console.log("wpm", await p.getByTestId("result-wpm").textContent(), "| save:", await p.getByTestId("save-status").textContent());
await p.getByRole("link", { name: /practice/ }).click();
console.log("practice page:", await p.getByRole("heading", { level: 1 }).textContent());
console.log("errors:", errs);
await b.close();
