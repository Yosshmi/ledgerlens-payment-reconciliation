import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
test("demo investigation journey uses live API records", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "The full picture of your payments" }),
  ).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByText("480 transactions · INR", { exact: true }),
    ).toBeVisible();
  }).toPass({ timeout: 120000 });
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search transactions" })
    .fill("TXN_DEMO_00031");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("1 records · Page 1 of 1")).toBeVisible();
  await page.getByRole("link", { name: "TXN_DEMO_00031", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Event timeline" }),
  ).toBeVisible();
  await expect(
    page.getByText("Merchant credit failed", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/investigation.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Event timeline" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Incidents", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Incident inbox" }),
  ).toBeVisible();
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await expect(
    page.getByRole("heading", { name: "Investigation activity" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Settlements", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settlement processing" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment intelligence" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("worker completes signed payment, refund, settlement and incident workflows", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.FULL_STACK !== "true",
    "Requires the Redis worker and complete Docker stack",
  );
  const env = parse(readFileSync(".env"));
  await page.goto("/");
  await page.getByLabel("Email address").fill("admin@ledgerlens.dev");
  await page.getByLabel("Password", { exact: true }).fill(env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "The full picture of your payments" }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/auth/me")).json();
  const headers = { Origin: baseURL!, "X-CSRF-Token": me.csrf };
  const response = await page.request.post("/api/transactions", {
    headers,
    data: {
      merchantId: "MER_URBANCART",
      customerReference: "CUS_E2E",
      amountMinor: 45000,
      paymentMethod: "UPI",
      outcome: "SUCCESS",
    },
  });
  expect(response.status()).toBe(201);
  const payment = await response.json();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get("/api/transactions/" + payment.transactionId)
          ).json()
        ).status,
      { timeout: 60000 },
    )
    .toBe("SUCCESS");
  const refundData = {
    transactionId: payment.transactionId,
    amountMinor: 1000,
    reason: "End-to-end partial refund",
  };
  const refunds = await Promise.all(
    [1, 2].map(() =>
      page.request.post("/api/refunds", {
        headers: {
          ...headers,
          "Idempotency-Key": "e2e-" + payment.transactionId,
        },
        data: refundData,
      }),
    ),
  );
  expect(refunds.map((r) => r.status())).toEqual([201, 201]);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get("/api/transactions/" + payment.transactionId)
          ).json()
        ).refundedMinor,
      { timeout: 60000 },
    )
    .toBe(1000);
  const csv = `transaction_id,merchant_id,amount_minor,settlement_amount_minor,status,settled_at\n${payment.transactionId},MER_URBANCART,45000,44100,COMPLETED,${new Date().toISOString()}\n`;
  const upload = await page.request.post("/api/settlements/upload", {
    headers,
    multipart: {
      file: { name: "e2e.csv", mimeType: "text/csv", buffer: Buffer.from(csv) },
    },
  });
  expect(upload.status()).toBe(202);
  const job = await upload.json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/jobs/" + job.jobId)).json()).state,
      { timeout: 90000 },
    )
    .toBe("COMPLETED");
  const detail = await (
    await page.request.get("/api/transactions/" + payment.transactionId)
  ).json();
  expect(detail.settlements).toHaveLength(1);
  expect(detail.refunds).toHaveLength(1);
  expect(
    detail.events.some(
      (e: { eventType: string }) => e.eventType === "REFUND_SUCCESS",
    ),
  ).toBe(true);
  const issues = await (
    await page.request.get("/api/incidents?transactionId=TXN_DEMO_00031")
  ).json();
  const issue = issues.items[0];
  expect(issue).toBeTruthy();
  const update = await page.request.patch(
    "/api/incidents/" + issue.incident_id,
    {
      headers,
      data: {
        status: "INVESTIGATING",
        note: "Reviewed event trail in automated acceptance test",
        assignedToReference: "USR_ADMIN",
      },
    },
  );
  expect(update.status()).toBe(200);
  expect((await update.json()).activity.at(-1).actor).toBe("USR_ADMIN");
  await page.goto("/transactions/" + payment.transactionId);
  await expect(
    page.getByRole("heading", { name: "Event timeline" }),
  ).toBeVisible();
});
test("mobile navigation and demo permissions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open demo workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "The full picture of your payments" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Transaction explorer" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simulate payment" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
