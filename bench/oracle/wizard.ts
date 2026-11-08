import type { Page } from "playwright-core";

import type { Application, Submission } from "./types.js";

async function completeFromStep2(
  page: Page,
  application: Application,
  filePath: string,
): Promise<Submission> {
  await page.getByLabel("Company").fill(application.company);
  await page.getByLabel("Your role").selectOption({ label: application.role });
  await page.getByLabel("Team size").fill(String(application.teamSize));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/step\/3$/);

  await page.getByLabel(/Attachment/).setInputFiles(filePath);
  await page.getByLabel(/I confirm/).check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.waitForURL(/\/done\/sub_\d+$/);

  const submissionId = await page
    .locator("[data-submission-id]")
    .getAttribute("data-submission-id");
  if (!submissionId) throw new Error("submission id missing from receipt");
  return { submissionId };
}

export async function submitApplication(
  page: Page,
  application: Application,
  filePath: string,
): Promise<Submission> {
  await page.goto("/step/1");
  await page.getByLabel("Full name").fill(application.name);
  await page.getByLabel("Work email").fill(application.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/step\/2$/);
  return completeFromStep2(page, application, filePath);
}

export async function submitWithRecovery(
  page: Page,
  application: Application,
  filePath: string,
): Promise<Submission> {
  await page.goto("/step/1");
  await page.getByLabel("Full name").fill(application.name);
  await page.getByLabel("Work email").fill("not-an-email");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForSelector('[role="alert"]');

  await page.getByLabel("Work email").fill(application.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/step\/2$/);
  return completeFromStep2(page, application, filePath);
}
