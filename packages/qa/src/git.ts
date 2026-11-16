import { execFileSync } from "node:child_process";

/**
 * Files changed relative to `baseRef`, including staged, unstaged, and
 * untracked files. A missing git repo is an empty diff, not a crash.
 */
export function gitChangedFiles(root: string, baseRef: string): string[] {
  const files = new Set<string>();

  const run = (args: string[]): string[] => {
    try {
      return execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    } catch {
      return [];
    }
  };

  for (const path of run(["diff", "--name-only", "--relative", `${baseRef}...HEAD`])) {
    files.add(path);
  }
  for (const path of run(["diff", "--name-only", "--relative"])) files.add(path);
  for (const path of run(["ls-files", "--others", "--exclude-standard"])) files.add(path);

  return [...files].sort();
}
