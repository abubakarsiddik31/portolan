import type { OpDef, SiteMap } from "@abubakarsiddiik/protocol";

import type { OpHealthRecord, OpHealthStatus } from "./health.js";
import type { MapStore } from "./maps.js";
import type { SessionStore } from "./store.js";

export type CanaryCheck = (input: {
  site: string;
  map: SiteMap;
  op: OpDef;
  params: Record<string, unknown>;
}) => Promise<{ ok: boolean; message?: string }>;

export type CanaryOptions = {
  maps: MapStore;
  store: SessionStore;
  check: CanaryCheck;
  /** Param sets keyed by `${site}:${op}` or just `op`. */
  params?: Record<string, Array<Record<string, unknown>>>;
  intervalMs?: number;
  now?: () => string;
};

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Run read ops on a schedule and record one status per op.
 *
 * Writes are never canaried: a canary must not place an order or delete an
 * account. A read op with required params is skipped until the caller supplies
 * param sets for it; the health endpoint reports it as unknown, not healthy.
 */
export class CanaryScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: CanaryOptions) {}

  async runOnce(site?: string): Promise<OpHealthRecord[]> {
    const now = this.options.now ?? (() => new Date().toISOString());
    const sites = site !== undefined ? [site] : this.options.maps.list().map((entry) => entry.site);
    const records: OpHealthRecord[] = [];

    for (const name of sites) {
      const map = this.options.maps.get(name);
      if (map === undefined) continue;

      for (const op of map.ops) {
        if (op.effect !== "read") continue;

        const sets = this.options.params?.[`${name}:${op.name}`] ?? this.options.params?.[op.name];
        const required = requiredParams(op);
        const paramSets = sets ?? (required.length === 0 ? [{}] : undefined);

        if (paramSets === undefined || paramSets.length === 0) continue;

        const started = Date.now();
        let passed = 0;
        let message: string | undefined;

        for (const params of paramSets) {
          try {
            const result = await this.options.check({ site: name, map, op, params });
            if (result.ok) {
              passed += 1;
            } else {
              message ??= result.message ?? `op "${op.name}" failed`;
            }
          } catch (error) {
            message ??= error instanceof Error ? error.message : String(error);
          }
        }

        const status: OpHealthStatus =
          passed === paramSets.length ? "healthy" : passed === 0 ? "broken" : "degraded";

        const record: OpHealthRecord = {
          site: name,
          op: op.name,
          map_version: map.version,
          status,
          checked_at: now(),
          ...(message !== undefined ? { message } : {}),
          ms: Date.now() - started,
        };

        this.options.store.recordOpHealth(record);
        records.push(record);
      }
    }

    return records;
  }

  start(): void {
    if (this.timer !== undefined) return;

    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

function requiredParams(op: OpDef): string[] {
  const required = op.params.required;

  if (Array.isArray(required)) {
    return required.filter((name): name is string => typeof name === "string");
  }

  const properties = op.params.properties;
  return typeof properties === "object" && properties !== null ? Object.keys(properties) : [];
}
