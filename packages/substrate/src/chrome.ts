import { existsSync } from "node:fs";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

/**
 * Find a Chrome or Chromium binary.
 *
 * `playwright-core` does not download a browser, so the adapter needs one on
 * the machine. `CHROME_PATH` wins when set; otherwise the usual install
 * locations are tried. Tests skip when this returns undefined.
 */
export function findChrome(): string | undefined {
  const configured = process.env.CHROME_PATH;
  if (configured !== undefined && configured.length > 0) {
    return existsSync(configured) ? configured : undefined;
  }

  return CANDIDATES.find((path) => existsSync(path));
}
