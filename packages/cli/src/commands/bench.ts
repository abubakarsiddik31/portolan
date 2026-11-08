import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const BENCH_SUITES = ["pilot", "n3", "drift", "conformance", "oracle", "local"] as const;

export type BenchSuite = (typeof BENCH_SUITES)[number];

export type BenchInput = {
  suite?: string;
  list?: boolean;
};

export type BenchDeps = {
  /** Run a suite and return its exit code. */
  run?: (suite: BenchSuite) => Promise<number>;
  /** The directory containing `bench/package.json`. */
  findRoot?: () => string | undefined;
};

export type BenchResult =
  | { listed: true; suites: readonly BenchSuite[] }
  | { listed: false; suite: BenchSuite; code: number };

/**
 * Run a benchmark suite from the source checkout.
 *
 * The benchmark harness lives in `bench/` and is not part of the published
 * package; the command is a convenience for a checkout, not a shipped runner.
 */
export async function runBench(input: BenchInput, deps: BenchDeps = {}): Promise<BenchResult> {
  if (input.list === true || input.suite === undefined) {
    return { listed: true, suites: BENCH_SUITES };
  }

  const suite = input.suite;
  if (!BENCH_SUITES.includes(suite as BenchSuite)) {
    throw new Error(`unknown suite "${suite}"; try: ${BENCH_SUITES.join(", ")}`);
  }

  const run = deps.run ?? defaultRun(deps.findRoot);
  const code = await run(suite as BenchSuite);
  return { listed: false, suite: suite as BenchSuite, code };
}

function defaultRun(findRoot: BenchDeps["findRoot"]): (suite: BenchSuite) => Promise<number> {
  return (suite) => {
    const root = (findRoot ?? findRepoRoot)();
    if (root === undefined) {
      return Promise.reject(
        new Error("bench needs the source checkout: no bench/package.json above this directory"),
      );
    }

    return new Promise((resolvePromise, reject) => {
      const child = spawn("pnpm", ["--filter", "@portolan/bench", "run", suite], {
        cwd: root,
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code) => resolvePromise(code ?? 1));
    });
  };
}

function findRepoRoot(start = process.cwd()): string | undefined {
  let dir = resolve(start);

  for (;;) {
    if (existsSync(join(dir, "bench/package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
