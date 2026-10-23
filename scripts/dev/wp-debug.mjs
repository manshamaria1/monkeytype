// Dev helper: open a WordPress page as a user and print errors, toasts and the app's text.
import { chromium } from "@playwright/test";
const [user, pass, path] = process.argv.slice(2);
const base = process.env.WP_URL ?? "http://localhost:8080";
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("pageerror:", e.message, "\n", (e.stack || "").split("\n").slice(0, 4).join("\n")));
p.on("console", (m) => m.type() === "error" && !m.text().includes("TUNNEL") && console.log("console:", m.text()));
p.on("response", (r) => r.url().includes("typing-test/v1") && console.log("api", r.status(), r.url().split("rest_route=")[1]));
await p.goto(`${base}/wp-login.php`);
await p.fill("#user_login", user);
await p.fill("#user_pass", pass);
await p.click("#wp-submit");
await p.waitForLoadState();
await p.goto(base + path);
await p.waitForTimeout(4000);
console.log("text:", (await p.locator("#typing-test-root").innerText()).replace(/\s+/g, " ").slice(0, 300));
await b.close();
