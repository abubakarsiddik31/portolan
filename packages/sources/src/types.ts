import type { JsonSchema, OpDef, StateDef } from "@abubakarsiddiik/protocol";

/** Where a candidate op came from. Every proposal carries its provenance. */
export type MapSourceKind = "dom" | "codebase" | "openapi" | "har" | "traces";

export type MapTriggerKind = "link" | "form" | "button";

/** The UI element a proposal came from, used to reconcile a capability ledger. */
export type MapTrigger = {
  kind: MapTriggerKind;
  name: string;
  /** State id of the page the element is on. */
  page: string;
};

export type OpProposal = {
  /** A draft op. It is not callable until verification promotes it. */
  op: OpDef;
  source: MapSourceKind;
  /** File, URL, or spec locator a reviewer can follow. */
  provenance: string;
  confidence: "high" | "medium" | "low";
  /** Observed parameter sets, when the source had them. */
  sample_params?: Array<Record<string, unknown>>;
  trigger?: MapTrigger;
  notes?: string[];
};

export type SurfaceActionKind = MapTriggerKind;

/** One interactive element observed on one page. */
export type SurfaceAction = {
  page: string;
  kind: SurfaceActionKind;
  name: string;
  /** Target state for a link. */
  target?: string;
  href?: string;
  /** The control was disabled every time the crawl saw it. */
  disabled?: boolean;
};

export type CapabilityStatus = "mapped" | "missing" | "excluded" | "stale" | "unavailable";

export type CapabilitySource = "live" | "code" | "manual";

export type Capability = {
  id: string;
  page: string;
  trigger: { kind: SurfaceActionKind; name: string; target?: string };
  status: CapabilityStatus;
  source: CapabilitySource;
  /** The map op that covers this capability, when mapped. */
  op?: string;
  /** Why it is excluded or stale. */
  reason?: string;
  /** What must be true before an `unavailable` control can be used. */
  precondition?: string;
};

export type CapabilityLedger = {
  schema: 1;
  site: string;
  generated_at: string;
  capabilities: Capability[];
};

export type CapabilityCoverage = {
  total: number;
  mapped: number;
  missing: number;
  excluded: number;
  stale: number;
  unavailable: number;
  /** Mapped / (mapped + missing), 0 when everything is excluded. */
  ratio: number;
};

export type DraftTaskKind =
  | "name_op"
  | "add_params"
  | "add_outcome_check"
  | "confirm_effect"
  | "add_locators"
  | "resolve_route"
  | "restore_op";

export type DraftTask = {
  id: string;
  kind: DraftTaskKind;
  source: MapSourceKind;
  op?: string;
  message: string;
};

/**
 * The reviewable artifact between discovery and a published map.
 *
 * A draft may hold invalid or unverifiable ops on purpose: it is evidence, not
 * a contract. Only `publishMap` writes a version the runtime will load.
 */
export type MapDraft = {
  schema: 1;
  site: string;
  origins: string[];
  created_at: string;
  sources: MapSourceKind[];
  states: StateDef[];
  proposals: OpProposal[];
  tasks: DraftTask[];
  entities: Record<string, JsonSchema>;
  build: {
    url?: string;
    base_url?: string;
    verify: boolean;
    verified: string[];
    published?: number;
    /** The crawl stopped at a limit with pages still queued. */
    crawl_truncated?: { limit: "max-pages" | "max-ops"; value: number; queued: number };
  };
};
