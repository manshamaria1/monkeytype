import { expect, type Page } from "@playwright/test";

/** The words currently shown in the typing test (target text, not typed text). */
export async function shownWords(page: Page): Promise<string[]> {
  await page.waitForSelector('[data-testid="words"] .word');
  return page.$$eval('[data-testid="words"] .word', (els) =>
    els.map((e) => Array.from(e.querySelectorAll(".letter:not(.extra)")).map((l) => l.firstChild?.textContent ?? "").join("")),
  );
}

export async function typeWords(page: Page, words: string[], delay = 25) {
  for (let i = 0; i < words.length; i++) {
    await page.keyboard.type(words[i], { delay });
    if (i < words.length - 1) await page.keyboard.press("Space", { delay });
  }
}

/** Fresh state: clear local storage and pick a words test of the given length. */
export async function startWordsTest(page: Page, count: 10 | 25 = 10) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("group", { name: "Test mode" }).getByRole("button", { name: "words" }).click();
  await page.getByRole("group", { name: "Number of words" }).getByRole("button", { name: String(count), exact: true }).click();
  await page.locator('[data-testid="typing-input"]').focus();
}

export async function register(page: Page, username: string) {
  await page.goto("/account/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Email").fill(`${username}@example.com`);
  await page.getByLabel("Password (8+ characters)").fill("password123");
  await page.getByLabel("Confirm password").fill("password123");
  await page.getByRole("button", { name: "create account" }).click();
  await expect(page).toHaveURL("/");
}
