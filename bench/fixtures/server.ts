import { buildStoreApp } from "./store/v1/app.js";

function readArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value ?? fallback;
}

const fixture = readArg("--fixture", "store");
const port = Number(readArg("--port", fixture === "store" ? "4100" : "4101"));

if (fixture !== "store") {
  console.error(`unknown fixture "${fixture}"; the store is the only v1 fixture so far (T1.04)`);
  process.exit(1);
}

const app = await buildStoreApp({ logger: true });
await app.listen({ host: "127.0.0.1", port });
console.log(`store v1 listening on http://127.0.0.1:${port}`);
