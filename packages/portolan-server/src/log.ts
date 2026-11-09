import { isSensitiveKey, REDACTED, redactText } from "@portolan/runtime";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

/**
 * A structured logger: one JSON object per line.
 *
 * The runtime writes logs a machine reads, not prose a human greps. Every
 * field is redacted by key before it is written, so a credential passed in a
 * field name cannot reach stdout.
 */
export type Logger = {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger with fields merged into every line. */
  child(fields: LogFields): Logger;
};

export type LoggerOptions = {
  /** Default `info`. */
  level?: LogLevel;
  /** Defaults to stdout. */
  write?: (line: string) => void;
  /** Fields on every line, e.g. `{ service: "portolan-server" }`. */
  base?: LogFields;
  now?: () => Date;
};

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVELS[options.level ?? "info"];
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const make = (base: LogFields): Logger => {
    const emit = (level: LogLevel, event: string, fields?: LogFields): void => {
      if (LEVELS[level] < threshold) return;

      const record = {
        ts: now().toISOString(),
        level,
        event,
        ...redactFields(base),
        ...redactFields(fields ?? {}),
      };

      write(JSON.stringify(record));
    };

    return {
      debug: (event, fields) => emit("debug", event, fields),
      info: (event, fields) => emit("info", event, fields),
      warn: (event, fields) => emit("warn", event, fields),
      error: (event, fields) => emit("error", event, fields),
      child: (fields) => make({ ...base, ...fields }),
    };
  };

  return make(options.base ?? {});
}

function redactFields(fields: LogFields): LogFields {
  const result: LogFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = redactValue(value);
  }

  return result;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));

  if (value !== null && typeof value === "object") {
    return redactFields(value as LogFields);
  }

  if (typeof value === "string") return redactText(value);

  return value;
}
