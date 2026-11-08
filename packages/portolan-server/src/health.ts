import type { Effect, SiteMap } from "@portolan/protocol";

export type OpHealthStatus = "healthy" | "degraded" | "broken";

export type OpHealthRecord = {
  site: string;
  op: string;
  map_version?: number;
  status: OpHealthStatus;
  checked_at: string;
  message?: string;
  ms?: number;
};

export type OpHealth = {
  name: string;
  effect: Effect;
  status: OpHealthStatus | "unknown";
  checked_at?: string;
  message?: string;
  ms?: number;
};

export type SiteHealth = {
  site: string;
  version: number;
  checked_at?: string;
  ops: OpHealth[];
};

/** Merge the latest stored status with every op in the map. */
export function mergeHealth(map: SiteMap, records: OpHealthRecord[]): SiteHealth {
  const byOp = new Map(records.map((record) => [record.op, record]));
  const checked = records
    .map((record) => record.checked_at)
    .sort()
    .at(-1);

  return {
    site: map.site,
    version: map.version,
    ...(checked !== undefined ? { checked_at: checked } : {}),
    ops: map.ops.map((op) => {
      const record = byOp.get(op.name);

      return {
        name: op.name,
        effect: op.effect,
        status: record?.status ?? "unknown",
        ...(record?.checked_at !== undefined ? { checked_at: record.checked_at } : {}),
        ...(record?.message !== undefined ? { message: record.message } : {}),
        ...(record?.ms !== undefined ? { ms: record.ms } : {}),
      };
    }),
  };
}
