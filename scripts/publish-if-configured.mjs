#!/usr/bin/env node
import { spawnSync } from "node:child_process";

if (process.env.NPM_TOKEN === undefined || process.env.NPM_TOKEN === "") {
  console.warn("NPM_TOKEN is not set; skipping npm publish.");
  console.warn("Add the repository secret NPM_TOKEN to publish @portolan/* packages.");
  process.exit(0);
}

const result = spawnSync("pnpm", ["release"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
