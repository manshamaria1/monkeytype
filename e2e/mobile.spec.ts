import { expect, test } from "@playwright/test";
import { shownWords } from "./helpers";

test("mobile: menu works and a test can be completed with the on-screen keyboard input", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // No horizontal scrolling on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: /leaderboard/ }).click();
  await expect(page).toHaveURL(/leaderboard/);
  await page.goto("/");
  await page.getByRole("group", { name: "Test mode" }).getByRole("button", { name: "words" }).click();
  await page.getByRole("group", { name: "Number of words" }).getByRole("button", { name: "10", exact: true }).click();
  await page.getByTestId("words").tap();
  const words = await shownWords(page);
  const input = page.getByTestId("typing-input");
  // Mobile keyboards often insert a whole word plus a space at once (autocomplete).
  for (const w of words.slice(0, -1)) await input.pressSequentially(w + " ", { delay: 20 });
  await input.pressSequentially(words.at(-1)!, { delay: 20 });
  await expect(page.getByTestId("results")).toBeVisible();
  await expect(page.getByTestId("result-acc")).toHaveText("100%");
});
