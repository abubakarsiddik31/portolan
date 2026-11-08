import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";

import type { Site } from "./sites.js";

export type OracleSession = {
  browser: Browser;
  contexts: Map<Site, BrowserContext>;
  pages: Map<Site, Page>;
  baseURLs: Record<Site, string>;
};

export type OracleSessionOptions = {
  baseURLs: Record<Site, string>;
  chromePath?: string;
};

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function createOracleSession(options: OracleSessionOptions): Promise<OracleSession> {
  const executablePath = options.chromePath ?? process.env.CHROME_PATH ?? DEFAULT_CHROME;
  const browser = await chromium.launch({ executablePath, headless: true });
  return { browser, contexts: new Map(), pages: new Map(), baseURLs: options.baseURLs };
}

export async function pageFor(session: OracleSession, site: Site): Promise<Page> {
  const existing = session.pages.get(site);
  if (existing) return existing;

  const context = await session.browser.newContext({ baseURL: session.baseURLs[site] });
  const page = await context.newPage();
  session.contexts.set(site, context);
  session.pages.set(site, page);
  return page;
}

export async function closeOracleSession(session: OracleSession): Promise<void> {
  for (const context of session.contexts.values()) {
    await context.close();
  }
  await session.browser.close();
}
