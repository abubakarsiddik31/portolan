export type ParsedArgs = {
  positional: string[];
  flags: Record<string, string | true>;
  /** Repeated `--flag value` pairs, in order. */
  lists: Record<string, string[]>;
};

/** Flags that never take a value, so `--publish trace.json` leaves the trace positional. */
const BOOLEAN_FLAGS = new Set([
  "allow-cost",
  "force",
  "headed",
  "json",
  "list",
  "no-dedupe",
  "no-infer-post",
  "publish",
  "require-complete",
  "require-post",
  "reverify",
  "strict",
  "verify",
  "verify-writes",
]);

/**
 * A tiny argument parser: `--key value`, `--flag`, and positionals.
 *
 * A repeated flag keeps every value in `lists`; a single value also lands in
 * `flags`. There is no dependency and no shell-style quoting, because the CLI
 * is called by another program as often as by a person.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const lists: Record<string, string[]> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (!arg.startsWith("--") || arg === "--") {
      positional.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const equals = body.indexOf("=");
    const key = equals === -1 ? body : body.slice(0, equals);
    const inline = equals === -1 ? undefined : body.slice(equals + 1);

    if (key.length === 0) {
      positional.push(arg);
      continue;
    }

    let value: string | true = true;

    if (inline !== undefined) {
      value = inline;
    } else if (!BOOLEAN_FLAGS.has(key)) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        index += 1;
      }
    }

    flags[key] = value;
    if (value !== true) {
      const list = lists[key] ?? [];
      list.push(value);
      lists[key] = list;
    }
  }

  return { positional, flags, lists };
}

export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function listFlag(args: ParsedArgs, name: string): string[] {
  return args.lists[name] ?? [];
}

export function numberFlag(args: ParsedArgs, name: string): number | undefined {
  const value = stringFlag(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer`);
  return parsed;
}

export function booleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === "true";
}
