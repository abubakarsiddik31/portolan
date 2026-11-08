import { readFileSync } from "node:fs";

import type { Page } from "playwright-core";

import type { ExportResult, InvoiceRow } from "./types.js";

async function readRows(page: Page): Promise<InvoiceRow[]> {
  return page.locator('[data-testid="invoice-row"]').evaluateAll((rows) =>
    rows.map((row) => ({
      id: row.querySelector("td:nth-child(1)")?.textContent?.trim() ?? "",
      vendor: row.querySelector("td:nth-child(2)")?.textContent?.trim() ?? "",
      category: row.querySelector("td:nth-child(3)")?.textContent?.trim() ?? "",
      amount: row.querySelector("td:nth-child(4)")?.textContent?.trim() ?? "",
      status: row.querySelector("[data-status]")?.getAttribute("data-status") ?? "",
      date: row.querySelector("td:nth-child(6)")?.textContent?.trim() ?? "",
    })),
  );
}

export async function login(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/$/);
}

export async function filterInvoices(page: Page, status: string): Promise<InvoiceRow[]> {
  await page.getByLabel("Status").selectOption(status);
  await page.getByRole("button", { name: "Filter" }).click();
  await page.waitForURL(new RegExp(`status=${status}`));
  return readRows(page);
}

export async function paginate(page: Page, pageNumber: number): Promise<InvoiceRow[]> {
  await page.goto(`/?page=${pageNumber}`);
  return readRows(page);
}

export async function exportCsv(page: Page, status: string): Promise<ExportResult> {
  await page.getByLabel("Status").selectOption(status);
  await page.getByRole("button", { name: "Filter" }).click();
  await page.waitForURL(new RegExp(`status=${status}`));

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Export CSV" }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error("download path missing");

  return {
    filename: download.suggestedFilename(),
    content: readFileSync(path, "utf8"),
  };
}
