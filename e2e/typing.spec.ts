import { expect, test } from "@playwright/test";
import { register, shownWords, startWordsTest, typeWords } from "./helpers";

test.describe("typing test", () => {
  test("type correct and wrong letters, backspace, finish and review results", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await startWordsTest(page, 10);
    const words = await shownWords(page);
    expect(words).toHaveLength(10);

    // First word: one wrong letter, corrected with backspace.
    await page.keyboard.type(words[0].slice(0, 1), { delay: 30 });
    await page.keyboard.type("#", { delay: 30 });
    await expect(page.locator(".word.active .letter.incorrect")).toHaveCount(1);
    await page.keyboard.press("Backspace");
    await expect(page.locator(".word.active .letter.incorrect")).toHaveCount(0);
    await page.keyboard.type(words[0].slice(1), { delay: 30 });
    await page.keyboard.press("Space");
    // Second word typed with an uncorrected extra letter.
    await page.keyboard.type(words[1] + "q", { delay: 30 });
    await expect(page.locator(".word.active .letter.extra")).toHaveText("q");
    await page.keyboard.press("Space");
    await typeWords(page, words.slice(2));

    const results = page.getByTestId("results");
    await expect(results).toBeVisible();
    const wpm = Number(await page.getByTestId("result-wpm").textContent());
    expect(wpm).toBeGreaterThan(20);
    expect(wpm).toBeLessThan(400);
    const acc = parseFloat((await page.getByTestId("result-acc").textContent()) ?? "0");
    expect(acc).toBeGreaterThan(90);
    expect(acc).toBeLessThan(100);
    await expect(page.getByTestId("result-backspaces")).toHaveText("1");
    await expect(page.getByTestId("result-errors")).toHaveText("3"); // "#", "q", and the space after the wrong word
    await expect(page.getByTestId("result-chars")).toHaveText(/\/0\/1\/0$/); // 0 incorrect, 1 extra, 0 missed
    await expect(page.getByTestId("save-status")).toContainText("Saved on this device only");
    // 10 words with >75% accuracy and default settings would be ranked.
    await expect(page.getByTestId("eligibility")).toContainText("would be eligible if you were signed in");
    expect(errors).toEqual([]);
  });

  test("restart with tab gives new text and resets state; retry keeps the text", async ({ page }) => {
    await startWordsTest(page, 10);
    const first = await shownWords(page);
    await page.keyboard.type(first[0].slice(0, 2), { delay: 30 });
    await page.keyboard.press("Tab");
    const second = await shownWords(page);
    expect(second.join(" ")).not.toBe(first.join(" "));
    await expect(page.locator(".letter.correct")).toHaveCount(0);
    await typeWords(page, second);
    await expect(page.getByTestId("results")).toBeVisible();
    await page.getByTestId("retry-test").click();
    expect(await shownWords(page)).toEqual(second);
  });

  test("timed test ends on its own at the configured time", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("group", { name: "Test mode" }).getByRole("button", { name: "time" }).click();
    await page.getByRole("group", { name: "Test duration in seconds" }).getByRole("button", { name: "custom" }).click();
    await page.getByPlaceholder("seconds").fill("5");
    await page.getByRole("button", { name: "set" }).click();
    await page.locator('[data-testid="typing-input"]').focus();
    const words = await shownWords(page);
    const started = Date.now();
    await typeWords(page, words.slice(0, 4), 40);
    await expect(page.getByTestId("results")).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
    await expect(page.getByTestId("results")).toContainText("time 5s");
    await expect(page.getByTestId("results")).toContainText("5s");
  });

  test("settings and theme persist across reloads; reset restores defaults", async ({ page }) => {
    await page.goto("/settings");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const before = await bg();
    await page.getByRole("button", { name: "Midnight" }).click();
    await expect.poll(bg).toBe("rgb(15, 23, 42)");
    await page.getByRole("group", { name: "caretStyle" }).getByRole("button", { name: "block" }).click();
    await page.reload();
    await expect.poll(bg).toBe("rgb(15, 23, 42)");
    await expect(page.getByRole("group", { name: "caretStyle" }).getByRole("button", { name: "block" })).toHaveAttribute("aria-pressed", "true");
    await page.goto("/");
    await expect(page.locator(".caret")).toHaveClass(/caret-block/);
    await page.goto("/settings");
    await page.getByTestId("reset-settings").click();
    await page.getByRole("button", { name: "yes, reset" }).click();
    await expect.poll(bg).toBe(before);
  });

  test("command palette switches test mode", async ({ page }) => {
    await page.goto("/");
    await page.locator("body").click();
    await page.keyboard.press("Escape");
    const input = page.getByPlaceholder(/Type to search/);
    await expect(input).toBeVisible();
    await input.fill("words 25");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Number of words" }).getByRole("button", { name: "25", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await shownWords(page)).toHaveLength(25);
  });

  test("shortcuts panel and alt+shift navigation", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { name: "About Monkeytype" })).toBeVisible();
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Alt+Shift+KeyL");
    await expect(page).toHaveURL(/\/leaderboard/);
  });

  test("RTL language renders right-to-left and can be typed", async ({ page }) => {
    await startWordsTest(page, 10);
    await page.getByRole("button", { name: /Language: English/ }).click();
    await page.getByRole("option", { name: /Arabic/ }).click();
    await expect(page.locator(".words-viewport")).toHaveAttribute("dir", "rtl");
    await page.locator('[data-testid="typing-input"]').focus();
    const words = await shownWords(page);
    await typeWords(page, words);
    await expect(page.getByTestId("results")).toBeVisible();
    await expect(page.getByTestId("result-acc")).toHaveText("100%");
  });
});

test.describe("accounts, history and leaderboard", () => {
  test("register, save a result, see it in history and on the leaderboard", async ({ page }) => {
    const username = `e2e_${Date.now() % 1_000_000}`;
    await register(page, username);
    await startWordsTest(page, 10);
    const words = await shownWords(page);
    await typeWords(page, words, 60);
    await expect(page.getByTestId("save-status")).toContainText("Result saved to your account");
    await expect(page.getByTestId("eligibility")).toContainText("eligible and counts");

    await page.goto("/stats");
    await expect(page.getByTestId("stat-tiles")).toContainText("tests completed");
    await expect(page.getByTestId("history-table").locator("tbody tr")).toHaveCount(1);
    await page.getByTestId("history-table").locator("tbody a").first().click();
    await expect(page.getByTestId("results")).toBeVisible();

    await page.goto("/leaderboard?mode=words&mode2=10");
    await expect(page.getByTestId("leaderboard-table")).toContainText(username);
    await expect(page.getByTestId("my-rank")).toContainText("#1");

    // Sign out and back in.
    await page.goto("/profile");
    await page.getByRole("button", { name: "sign out" }).click();
    await page.goto("/account/login");
    await page.getByLabel("Email or username").fill(username);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "sign in" }).click();
    await expect(page.getByRole("link", { name: username })).toBeVisible();
  });

  test("signed-in settings changes survive an immediate reload (account sync)", async ({ page }) => {
    await register(page, `sync_${Date.now() % 1_000_000}`);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Forest" }).click();
    await page.reload(); // before the debounced upload would have run
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(29, 38, 33)");
    await expect(page.getByTestId("sync-status")).toContainText("Synced");
    // A fresh device (no local settings) gets the account's settings.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(29, 38, 33)");
  });

  test("a failed save shows an error and can be retried", async ({ page }) => {
    await register(page, `net_${Date.now() % 1_000_000}`);
    await startWordsTest(page, 10);
    await page.route("**/api/results", (route) => route.abort());
    const words = await shownWords(page);
    await typeWords(page, words, 40);
    await expect(page.getByTestId("save-status")).toContainText("Result not saved");
    await page.unroute("**/api/results");
    await page.getByTestId("save-status").getByRole("button", { name: "retry" }).click();
    await expect(page.getByTestId("save-status")).toContainText("Result saved to your account");
  });

  test("leaderboard shows an empty state and the ranking rules", async ({ page }) => {
    await page.goto("/leaderboard?period=daily&mode=time&mode2=120&language=german");
    await expect(page.getByText(/No results on this board today yet/)).toBeVisible();
    await page.getByText("How the leaderboard works").click();
    await expect(page.getByText(/higher WPM first, then higher accuracy/)).toBeVisible();
  });
});

test.describe("practice and multiplayer", () => {
  test("a lesson shows finger guidance and pass/fail feedback", async ({ page }) => {
    await page.goto("/practice/lesson/fj");
    await expect(page.getByText(/Rest your left index finger on F/)).toBeVisible();
    await expect(page.locator(".kb-key.next")).toHaveCount(1);
    await page.locator('[data-testid="typing-input"]').focus();
    const words = await shownWords(page);
    await typeWords(page, words, 70);
    await expect(page.getByTestId("lesson-outcome")).toBeVisible();
  });

  test("two players race in a room", async ({ browser }) => {
    const host = await (await browser.newContext()).newPage();
    const guest = await (await browser.newContext()).newPage();
    await host.goto("/multiplayer");
    await host.getByLabel("Your name (guests)").fill("Hosty");
    await host.getByTestId("create-room").click();
    const code = (await host.getByTestId("room-code").textContent())!.trim();
    await guest.goto(`/multiplayer`);
    await guest.getByLabel("Your name (guests)").fill("Guesty");
    await guest.getByLabel("Room code").fill(code);
    await guest.getByRole("button", { name: "join room" }).click();
    await expect(guest.getByTestId("room")).toContainText("Hosty");
    await guest.getByTestId("ready").click();
    await expect(host.getByText("ready", { exact: true })).toBeVisible();
    await host.getByTestId("start-race").click();
    await expect(host.getByTestId("countdown")).toBeVisible();
    await expect(host.getByTestId("countdown")).toBeHidden({ timeout: 6000 });
    const words = await shownWords(host);
    expect(await shownWords(guest)).toEqual(words);
    await host.locator('[data-testid="typing-input"]').focus();
    await typeWords(host, words, 40);
    await expect(host.getByText("Finished! Waiting for the other players")).toBeVisible();
    await guest.locator('[data-testid="typing-input"]').focus();
    await typeWords(guest, words, 60);
    await expect(host.getByTestId("race-results")).toContainText("You won!");
    await expect(guest.getByTestId("race-results")).toContainText("You placed #2");
  });
});
