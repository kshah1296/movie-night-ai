import { test, expect } from "@playwright/test";

// QA-E2E — the "white screen" smoke test: visit every primary route and assert it renders
// the app shell without the error boundary firing. This is the cheapest guard against the
// class of render-crash bug that previously took a whole page down.

const ROUTES = ["/", "/search", "/watchlist", "/ratings", "/taste", "/settings", "/group"];

test("every primary route renders without the error boundary", async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(route);
    // the sticky nav (brand link) should be present on every page
    await expect(page.getByRole("link", { name: /Movie Night AI/ })).toBeVisible();
    // the error boundary must NOT have caught anything
    await expect(page.locator("body")).not.toContainText("Something went wrong");
    await expect(page.locator("body")).not.toContainText("The app hit a snag");
  }
});

test("command palette opens from the nav search button", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByPlaceholder(/Search any movie or person/i)).toBeVisible();
});

test("unknown route shows the custom 404, not a crash", async ({ page }) => {
  await page.goto("/this-route-does-not-exist");
  await expect(page.getByText(/Page not found/i)).toBeVisible();
});
