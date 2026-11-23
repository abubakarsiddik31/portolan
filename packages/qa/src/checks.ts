import type { SiteMap } from "@abubakarsiddiik/protocol";
import { checkPost, matchingNodes } from "@abubakarsiddiik/runtime";

import type { QaCheck } from "./spec.js";
import type { QaSubstrate, QaView } from "./types.js";

export type CheckOutcome =
  | { ok: true }
  | { ok: false; message: string; expected?: unknown; actual?: unknown };

export async function evaluateCheck(input: {
  check: QaCheck;
  view: QaView;
  substrate: QaSubstrate;
  map?: SiteMap;
}): Promise<CheckOutcome> {
  const { check, view, substrate, map } = input;

  if ("url" in check) {
    const path = pathname(view.snapshot.url);
    const ok = new RegExp(check.url).test(path);
    return ok
      ? { ok: true }
      : {
          ok: false,
          message: `url "${path}" did not match ${check.url}`,
          expected: check.url,
          actual: path,
        };
  }

  if ("text" in check) {
    const page = await substrate.read();
    const ok = page.text.includes(check.text.contains);
    return ok
      ? { ok: true }
      : {
          ok: false,
          message: `page text did not contain "${check.text.contains}"`,
          expected: check.text.contains,
        };
  }

  if ("visible" in check) {
    const nodes = matchingNodes(view.snapshot.nodes, check.visible);
    return nodes.length > 0
      ? { ok: true }
      : { ok: false, message: "expected a locator to be visible", expected: check.visible };
  }

  if ("absent" in check) {
    const nodes = matchingNodes(view.snapshot.nodes, check.absent);
    if (nodes.length === 0) return { ok: true };

    const node = nodes[0];
    const ref = node === undefined ? undefined : view.refs.byNode.get(node.nodeId)?.ref;

    return {
      ok: false,
      message: `expected locator to be absent, but it resolved${ref === undefined ? "" : ` as ${ref}`}`,
      expected: { absent: check.absent },
      actual: {
        resolved: check.absent,
        ...(ref !== undefined ? { ref } : {}),
        ...(node !== undefined ? { role: node.role, name: node.name } : {}),
      },
    };
  }

  if ("value" in check) {
    const node = matchingNodes(view.snapshot.nodes, check.value.target)[0];
    if (node === undefined) {
      return {
        ok: false,
        message: "value check target did not resolve",
        expected: check.value.equals,
      };
    }

    const ref = view.refs.byNode.get(node.nodeId)?.ref;
    if (ref === undefined) {
      return { ok: false, message: "value check target has no ref" };
    }

    const current = (await substrate.read(ref)).text;
    return current === check.value.equals
      ? { ok: true }
      : {
          ok: false,
          message: "value did not match",
          expected: check.value.equals,
          actual: current,
        };
  }

  if ("map_post" in check) {
    if (map === undefined) {
      return { ok: false, message: "map_post check needs a map" };
    }

    const op = map.ops.find((candidate) => candidate.name === check.map_post.op);
    if (op === undefined) {
      return { ok: false, message: `map_post op "${check.map_post.op}" is not in the map` };
    }

    for (const post of op.post) {
      const failure = checkPost(post, map, view);
      if (failure !== undefined) {
        return { ok: false, message: failure, expected: post };
      }
    }

    return { ok: true };
  }

  return { ok: false, message: "unknown check" };
}

function pathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
