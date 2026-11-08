import type { Impl, OpDef, SiteMap } from "@portolan/protocol";
import { validateJsonSchema } from "@portolan/protocol";
import { checkPost, runHttpOp, runUiOp, runUrlOp } from "@portolan/runtime";
import { findChrome, PlaywrightEngine, Substrate } from "@portolan/substrate";

export type VerifyRun = {
  params: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  state?: string;
  url?: string;
  message?: string;
  check?: { ok: boolean; message?: string };
};

export type ImplReport = {
  tier: Impl["tier"];
  verified: boolean;
  runs: VerifyRun[];
  reason?: string;
};

export type VerifyReport = {
  op: string;
  verified: boolean;
  impls: ImplReport[];
  reason?: string;
};

export type VerifyOptions = {
  map: SiteMap;
  op: OpDef;
  /** At least three: the verifier rejects a smaller set rather than guessing. */
  paramSets: Array<Record<string, unknown>>;
  baseUrl?: string;
  executablePath?: string;
  headless?: boolean;
  /** Ops to run on the same fresh session before the candidate. */
  setup?: Array<{ op: string; params: Record<string, unknown> }>;
};

const MIN_PARAM_SETS = 3;

/**
 * Verify every impl of an op on a fresh session.
 *
 * Each run gets its own browser context, so a write cannot inherit a cart or a
 * login from the previous run. The report is per impl: an op is verified when
 * at least one impl passes every param set, and each failure carries the run
 * that broke and why.
 */
export async function verifyOp(options: VerifyOptions): Promise<VerifyReport> {
  if (options.paramSets.length < MIN_PARAM_SETS) {
    return {
      op: options.op.name,
      verified: false,
      impls: [],
      reason: `at least ${MIN_PARAM_SETS} param sets are required`,
    };
  }

  const executablePath = options.executablePath ?? findChrome();
  if (executablePath === undefined) {
    return {
      op: options.op.name,
      verified: false,
      impls: [],
      reason: "Chrome is required to verify an op",
    };
  }

  const impls: ImplReport[] = [];

  for (const impl of options.op.impls) {
    const runs: VerifyRun[] = [];

    for (const params of options.paramSets) {
      runs.push(
        await runOnce({
          map: options.map,
          op: options.op,
          impl,
          params,
          executablePath,
          headless: options.headless ?? true,
          setup: options.setup ?? [],
          ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
        }),
      );
    }

    const failure = runs.find((run) => !run.ok);

    impls.push({
      tier: impl.tier,
      verified: failure === undefined,
      runs,
      ...(failure !== undefined
        ? { reason: failure.message ?? `run with ${JSON.stringify(failure.params)} failed` }
        : {}),
    });
  }

  const verified = impls.some((impl) => impl.verified);

  return {
    op: options.op.name,
    verified,
    impls,
    ...(verified ? {} : { reason: "every impl failed" }),
  };
}

async function runOnce(input: {
  map: SiteMap;
  op: OpDef;
  impl: Impl;
  params: Record<string, unknown>;
  executablePath: string;
  headless: boolean;
  baseUrl?: string;
  setup: Array<{ op: string; params: Record<string, unknown> }>;
}): Promise<VerifyRun> {
  const validation = validateJsonSchema(input.op.params, input.params);
  if (!validation.ok) {
    return {
      params: input.params,
      ok: false,
      message: `invalid params: ${validation.issues.map((issue) => issue.path).join(", ")}`,
    };
  }

  const engine = await PlaywrightEngine.launch({
    executablePath: input.executablePath,
    headless: input.headless,
  });

  try {
    const substrate = new Substrate(engine);
    const baseUrl = input.baseUrl ?? input.map.origins[0] ?? "";
    const firstSetup = input.setup[0];
    const startOp =
      firstSetup === undefined
        ? input.op
        : (input.map.ops.find((candidate) => candidate.name === firstSetup.op) ?? input.op);
    const startParams = firstSetup?.params ?? input.params;
    await engine.navigate(startUrl(input.map, startOp, startParams, baseUrl));

    for (const step of input.setup) {
      const setupOp = input.map.ops.find((candidate) => candidate.name === step.op);
      const setupImpl = setupOp?.impls[0];

      if (setupOp === undefined || setupImpl === undefined) {
        return {
          params: input.params,
          ok: false,
          message: `setup op "${step.op}" is not in the map`,
        };
      }

      const setupResult = await runImpl(
        input.map,
        setupOp,
        setupImpl,
        step.params,
        substrate,
        input.baseUrl,
      );

      if (!setupResult.ok) {
        return {
          params: input.params,
          ok: false,
          message: `setup "${step.op}" failed: ${setupResult.message}`,
        };
      }
    }

    const result = await runImpl(
      input.map,
      input.op,
      input.impl,
      input.params,
      substrate,
      input.baseUrl,
    );
    if (!result.ok) {
      return { params: input.params, ok: false, message: result.message };
    }

    // The http tier does not navigate, so its post checks run against the page
    // as it stands after the fetch. url and ui already checked theirs.
    if (input.impl.tier === "http") {
      const view = await substrate.view();

      for (const check of input.op.post) {
        const failure = checkPost(check, input.map, view);
        if (failure !== undefined) {
          return { params: input.params, ok: false, message: failure };
        }
      }
    }

    let check: { ok: boolean; message?: string } | undefined;

    if (input.op.outcome_check !== undefined) {
      const checkOp = input.map.ops.find((candidate) => candidate.name === input.op.outcome_check);
      const checkImpl = checkOp?.impls[0];

      if (checkOp !== undefined && checkImpl !== undefined) {
        const outcome = await runImpl(input.map, checkOp, checkImpl, {}, substrate, input.baseUrl);
        check = outcome.ok ? { ok: true } : { ok: false, message: outcome.message };
        if (!outcome.ok) {
          return {
            params: input.params,
            ok: false,
            message: `outcome_check "${checkOp.name}" failed: ${outcome.message}`,
            check,
          };
        }
      }
    }

    return {
      params: input.params,
      ok: true,
      result: result.result,
      ...(result.state !== undefined ? { state: result.state } : {}),
      ...(result.url !== undefined ? { url: result.url } : {}),
      ...(check !== undefined ? { check } : {}),
    };
  } finally {
    await engine.close();
  }
}

type ImplRun =
  | { ok: true; result: unknown; state?: string; url?: string }
  | { ok: false; message: string };

async function runImpl(
  map: SiteMap,
  op: OpDef,
  impl: Impl,
  params: Record<string, unknown>,
  substrate: Substrate,
  baseUrl: string | undefined,
): Promise<ImplRun> {
  switch (impl.tier) {
    case "url": {
      const result = await runUrlOp({
        map,
        op,
        params,
        substrate,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      });
      return result.ok
        ? { ok: true, result: result.result, state: result.state, url: result.url }
        : { ok: false, message: result.message };
    }
    case "http": {
      const result = await runHttpOp({
        map,
        op,
        params,
        substrate,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
      });
      return result.ok
        ? { ok: true, result: result.result, url: result.url }
        : { ok: false, message: result.message };
    }
    case "ui": {
      const result = await runUiOp({ map, op, params, substrate });
      return result.ok
        ? { ok: true, result: result.result, state: result.state }
        : { ok: false, message: result.message };
    }
    case "webmcp":
      return { ok: false, message: "webmcp impls are not supported by the verifier yet" };
  }
}

function startUrl(
  map: SiteMap,
  op: OpDef,
  params: Record<string, unknown>,
  baseUrl: string,
): string {
  const state = map.states.find((candidate) => candidate.id === op.from[0]);
  if (state?.url === undefined) return baseUrl;

  let missing = false;
  const path = state.url.replace(/:([a-zA-Z0-9_]+)/g, (_, name: string) => {
    const direct = params[name];
    const suffixed = Object.entries(params).find(([key]) => key.endsWith(name))?.[1];
    const value = direct ?? suffixed;
    if (value === undefined) {
      missing = true;
      return "";
    }
    return String(value);
  });

  if (missing) return baseUrl;
  return new URL(path, baseUrl).toString();
}
