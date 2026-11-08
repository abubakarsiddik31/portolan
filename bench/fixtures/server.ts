import { buildInjectionApp } from "./injection/v1/app.js";
import { buildLibraryApp } from "./library/v1/app.js";
import { buildPortalApp } from "./portal/v1/app.js";
import { buildStoreApp } from "./store/v1/app.js";
import { buildSupportApp } from "./support/v1/app.js";
import { buildWizardApp } from "./wizard/v1/app.js";

function readArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

const fixtures = {
  store: { build: buildStoreApp, label: "store", port: "4100" },
  wizard: { build: buildWizardApp, label: "wizard", port: "4101" },
  portal: { build: buildPortalApp, label: "portal", port: "4102" },
  library: { build: buildLibraryApp, label: "library", port: "4120" },
  support: { build: buildSupportApp, label: "support", port: "4121" },
  injection: { build: buildInjectionApp, label: "injection", port: "4130" },
} as const;

type FixtureName = keyof typeof fixtures;

const fixture = readArg("--fixture", "store") as FixtureName;
const entry = fixtures[fixture];

if (!entry) {
  console.error(
    `unknown fixture "${fixture}"; expected one of ${Object.keys(fixtures).join(", ")}`,
  );
  process.exit(1);
}

const port = Number(readArg("--port", entry.port));
const variant = readArg("--variant", "v1") as "v1" | "v2";
const app = await entry.build({ logger: true, variant });
await app.listen({ host: "127.0.0.1", port });
console.log(`${entry.label} ${variant} listening on http://127.0.0.1:${port}`);
