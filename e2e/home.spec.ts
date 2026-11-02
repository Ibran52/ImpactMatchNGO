import { expect, test } from "@playwright/test";

test("visitors can explore an opportunity and are prompted to sign in before applying", async ({ page }) => {
  await page.route("http://localhost:4000/api/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/auth/me")) {
      await route.fulfill({ json: { user: null } });
      return;
    }
    if (url.endsWith("/impact/summary")) {
      await route.fulfill({ json: { overview: {
        totalNgos: 1,
        verifiedNgos: 1,
        pendingNgos: 0,
        volunteers: 0,
        users: 1,
        fundsRaised: 0,
        activeTasks: 1,
        participatingCities: 1,
        donationMonths: [],
        userMonths: [],
        causes: [],
      } } });
      return;
    }
    if (url.endsWith("/ngos")) {
      await route.fulfill({ json: { ngos: [] } });
      return;
    }
    if (url.includes("/needs")) {
      await route.fulfill({ json: { needs: [{
        id: "sample-need",
        title: "A reading buddy for Saturday mornings",
        description: "Read with children at our neighbourhood learning space.",
        kind: "volunteer",
        category: "Education",
        city: "Pune",
        organizationName: "Udaan Learning Collective",
        organizationVerified: true,
        volunteersNeeded: 8,
        volunteersJoined: 5,
        urgency: "medium",
        createdAt: new Date().toISOString(),
      }] } });
      return;
    }
    await route.fulfill({ json: {} });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Small Acts.*Big Change/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A reading buddy for Saturday mornings" })).toBeVisible();
  await page.getByRole("link", { name: "Find Opportunities" }).click();
  await page.getByRole("button", { name: /Apply as Volunteer/ }).click();
  await expect(page.getByText("Sign in to apply for an opportunity.")).toBeVisible();
});
