import { randomUUID } from "node:crypto";

import { REDACTED, redactRecord, redactText } from "@abubakarsiddiik/runtime";

/** A tool call the agent made, with its arguments redacted. */
export type ActivityCall = {
  kind: "call";
  id: string;
  tool: string;
  args: unknown;
  at: string;
};

/** How a tool call ended. */
export type ActivityResult = {
  kind: "result";
  id: string;
  tool: string;
  ok: boolean;
  /** The typed error code when the call failed. */
  code?: string;
  /** The first part of the response text, redacted. */
  summary: string;
  ms: number;
  at: string;
};

/** A browser page opened, navigated, or closed. */
export type ActivityPage = {
  kind: "page";
  sid: string;
  status: "open" | "navigated" | "closed";
  url?: string;
  at: string;
};

/** One screencast frame from a session's page. */
export type ActivityFrame = {
  kind: "frame";
  sid: string;
  /** Base64 JPEG. */
  data: string;
  width: number;
  height: number;
  at: string;
};

export type ActivityEvent = ActivityCall | ActivityResult | ActivityPage | ActivityFrame;

export type ActivityListener = (event: ActivityEvent) => void;

export type ActivityFeedOptions = {
  /** Calls, results, and page events kept for a viewer that connects late. Default 500. */
  history?: number;
  /** Characters of a response kept in a result summary. Default 600. */
  summaryChars?: number;
  now?: () => Date;
};

type CallOutcome = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

/**
 * What the agent is doing, for a person to watch.
 *
 * Every MCP tool call and its outcome, plus the browser's frames. Nothing here
 * changes what the agent does: the feed only observes. Arguments and responses
 * are redacted by key and by credential shape before they are kept, because a
 * viewer is one more place a secret could leak to.
 *
 * Frames are not kept in history, only the latest one per session, so a viewer
 * that connects late sees the page as it is now without replaying a video.
 */
export class ActivityFeed {
  private readonly listeners = new Set<ActivityListener>();
  private readonly log: ActivityEvent[] = [];
  private readonly frames = new Map<string, ActivityFrame>();
  private readonly limit: number;
  private readonly summaryChars: number;
  private readonly now: () => Date;

  constructor(options: ActivityFeedOptions = {}) {
    this.limit = options.history ?? 500;
    this.summaryChars = options.summaryChars ?? 600;
    this.now = options.now ?? (() => new Date());
  }

  /** Listen for every event; returns the unsubscribe. */
  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The recent calls, results, and page events, then each session's latest frame. */
  snapshot(): ActivityEvent[] {
    return [...this.log, ...this.frames.values()];
  }

  /** Record a tool call; returns its id for `result`. */
  call(tool: string, args: unknown): string {
    const id = randomUUID();
    this.push({ kind: "call", id, tool, args: redactRecord(args), at: this.stamp() });
    return id;
  }

  /**
   * Record how a call ended, from the MCP response it returned. `scrub` lists
   * values, such as a typed password, to blank wherever the response echoes them.
   */
  result(id: string, tool: string, outcome: unknown, ms: number, scrub: string[] = []): void {
    const read = readOutcome(outcome);
    const { ok, code } = read;
    const text = scrub
      .filter((secret) => secret.length > 0)
      .reduce((value, secret) => value.split(secret).join(REDACTED), read.text);
    this.push({
      kind: "result",
      id,
      tool,
      ok,
      ...(code !== undefined ? { code } : {}),
      summary: clip(redactText(text), this.summaryChars),
      ms,
      at: this.stamp(),
    });
  }

  /** Record a call that threw instead of returning. */
  thrown(id: string, tool: string, error: unknown, ms: number): void {
    const message = error instanceof Error ? error.message : String(error);
    this.push({
      kind: "result",
      id,
      tool,
      ok: false,
      code: "thrown",
      summary: clip(redactText(message), this.summaryChars),
      ms,
      at: this.stamp(),
    });
  }

  page(sid: string, status: ActivityPage["status"], url?: string): void {
    if (status === "closed") this.frames.delete(sid);
    this.push({
      kind: "page",
      sid,
      status,
      ...(url !== undefined ? { url: redactText(url) } : {}),
      at: this.stamp(),
    });
  }

  frame(sid: string, data: string, width: number, height: number): void {
    const frame: ActivityFrame = { kind: "frame", sid, data, width, height, at: this.stamp() };
    this.frames.set(sid, frame);
    this.emit(frame);
  }

  private push(event: Exclude<ActivityEvent, ActivityFrame>): void {
    this.log.push(event);
    if (this.log.length > this.limit) this.log.splice(0, this.log.length - this.limit);
    this.emit(event);
  }

  private emit(event: ActivityEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken viewer must never break the agent's call.
      }
    }
  }

  private stamp(): string {
    return this.now().toISOString();
  }
}

function readOutcome(outcome: unknown): { ok: boolean; code?: string; text: string } {
  const value = (outcome ?? {}) as CallOutcome;
  const text = (value.content ?? [])
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter((part) => part.length > 0)
    .join("\n");

  let code: string | undefined;
  let failed = value.isError === true;
  try {
    const parsed = JSON.parse(text) as { ok?: unknown; code?: unknown; error?: { code?: unknown } };
    if (parsed.ok === false) failed = true;
    // Ops fail with `error.code`; a fallback `act` fails with a top-level `code`.
    if (typeof parsed.error?.code === "string") code = parsed.error.code;
    else if (failed && typeof parsed.code === "string") code = parsed.code;
  } catch {
    // Plain-text responses, such as `view`, carry no code.
  }

  return { ok: !failed, ...(code !== undefined ? { code } : {}), text };
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
