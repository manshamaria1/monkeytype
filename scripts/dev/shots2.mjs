// Dev helper: checks that a settings change survives an immediate reload while signed in.
import { chromium } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3000";
const out = process.env.OUT ?? "/tmp";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
await p.goto(base + "/account/login");
await p.getByLabel("Email or username").fill("visual_check");
await p.getByLabel("Password").fill("password123");
await p.getByRole("button", { name: "sign in" }).click();
await p.waitForURL(base + "/");
await p.goto(base + "/settings");
await p.getByRole("button", { name: "Classic light" }).click();
await p.goto(base + "/"); // immediate full reload
await p.waitForTimeout(1500);
console.log("bg after reload:", await p.evaluate(() => getComputedStyle(document.body).backgroundColor));
await p.locator('[data-testid="typing-input"]').focus();
await p.keyboard.type("the quick", { delay: 40 });
await p.screenshot({ path: `${out}/11-light-typing.png` });
await p.goto(base + "/profile");
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/08-profile.png` });
await p.goto(base + "/stats");
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/04-stats.png` });
await b.close();
