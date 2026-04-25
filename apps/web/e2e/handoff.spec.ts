import { expect, test } from "@playwright/test";

test.describe("Tier 0 signaling demo", () => {
  test("two browser contexts complete an offer / answer handoff via URL fragment", async ({
    browser,
  }) => {
    const inviterCtx = await browser.newContext();
    const joinerCtx = await browser.newContext();
    const inviter = await inviterCtx.newPage();
    const joiner = await joinerCtx.newPage();

    // ── Inviter ─────────────────────────────────────────────────────────────
    await inviter.goto("/");
    await inviter.locator("#btn-create-room").click();
    await expect(inviter.locator("#room-id")).toHaveText(/^[0-9a-hjkmnp-tv-z]{26}$/);

    await inviter.locator("#msg-kind").selectOption("offer");
    await inviter.locator("#btn-publish").click();
    await expect(inviter.locator("#inbox li", { hasText: "sent offer" })).toBeVisible();

    await inviter.locator("#btn-export").click();
    const inviteUrl = await inviter.locator("#export-out").inputValue();
    expect(inviteUrl).toMatch(/#i=[A-Za-z0-9_-]+&s=[A-Za-z0-9_-]+$/);

    // ── Joiner ──────────────────────────────────────────────────────────────
    await joiner.goto(inviteUrl);
    await expect(joiner.locator("#room-id")).toHaveText(/^[0-9a-hjkmnp-tv-z]{26}$/);
    await expect(
      joiner.locator("#inbox li", { hasText: /room = .* \(joiner; inviter = /i }),
    ).toBeVisible();
    await expect(joiner.locator("#inbox li", { hasText: "recv offer from" })).toBeVisible();

    // The joiner and inviter must agree on the room id.
    const inviterRoom = await inviter.locator("#room-id").innerText();
    const joinerRoom = await joiner.locator("#room-id").innerText();
    expect(joinerRoom).toBe(inviterRoom);

    // ── Joiner answers ──────────────────────────────────────────────────────
    await joiner.locator("#msg-kind").selectOption("answer");
    await joiner.locator("#btn-publish").click();
    await expect(joiner.locator("#inbox li", { hasText: "sent answer" })).toBeVisible();
    await joiner.locator("#btn-export").click();
    const answerUrl = await joiner.locator("#export-out").inputValue();
    expect(answerUrl).toMatch(/#s=[A-Za-z0-9_-]+$/);
    expect(answerUrl).not.toContain("i=");

    // ── Inviter imports the answer ──────────────────────────────────────────
    await inviter.locator("#import-in").fill(answerUrl);
    await inviter.locator("#btn-import").click();
    await expect(inviter.locator("#inbox li", { hasText: "recv answer from" })).toBeVisible();

    await inviterCtx.close();
    await joinerCtx.close();
  });

  test("rejects a URL with an unknown fragment key", async ({ browser }) => {
    const inviterCtx = await browser.newContext();
    const observerCtx = await browser.newContext();
    const inviter = await inviterCtx.newPage();
    const observer = await observerCtx.newPage();

    await inviter.goto("/");
    await inviter.locator("#btn-create-room").click();
    await inviter.locator("#msg-kind").selectOption("offer");
    await inviter.locator("#btn-publish").click();
    await inviter.locator("#btn-export").click();
    const cleanUrl = await inviter.locator("#export-out").inputValue();
    const tampered = cleanUrl.replace("#", "#evil=1&");

    await observer.goto(tampered);
    await expect(
      observer.locator("#inbox li", { hasText: /auto-import error: .* unknown fragment key/i }),
    ).toBeVisible();

    await inviterCtx.close();
    await observerCtx.close();
  });
});
