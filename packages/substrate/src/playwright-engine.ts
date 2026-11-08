import { type Browser, type CDPSession, chromium, type Frame, type Page } from "playwright-core";

import {
  type Action,
  type DispatchResult,
  type Effect,
  type Engine,
  EngineError,
  type NavigateResult,
  type NetworkEffect,
  type SemanticNode,
  type Snapshot,
} from "./engine.js";

export type PlaywrightEngineOptions = {
  executablePath: string;
  headless?: boolean;
  timeoutMs?: number;
  /** Extra Chromium flags, e.g. --no-sandbox in a container. */
  launchArgs?: string[];
};

type AxValue = { value?: string | number | boolean };

type AxProperty = {
  name: string;
  value?: AxValue;
};

type RawAxNode = {
  nodeId: string;
  ignored: boolean;
  role?: AxValue;
  name?: AxValue;
  backendDOMNodeId?: number;
  properties?: AxProperty[];
  childIds?: string[];
};

type RequestEvent = {
  requestId: string;
  request: { method: string; url: string };
};

type ResponseEvent = {
  requestId: string;
  response: { status: number };
};

type DomSnapshotResult = {
  strings: string[];
  documents: Array<{
    nodes: { backendNodeId: number[]; attributes?: number[][] };
    layout: { nodeIndex: number[]; bounds: number[][]; styles?: number[][] };
  }>;
};

type LayoutInfo = {
  bounds: { x: number; y: number; width: number; height: number };
  display: string;
  visibility: string;
  opacity: string;
  test_id?: string;
};

type DescribedNode = {
  backendNodeId?: number;
  children?: DescribedNode[];
};

type ResolvedNode = {
  object: { objectId?: string };
};

type CallResult = {
  result: { value?: unknown };
  exceptionDetails?: { text?: string };
};

export class PlaywrightEngine implements Engine {
  private readonly timeoutMs: number;
  private doc = 0;
  private v = 0;
  private readonly network = new Map<string, NetworkEffect>();
  private networkOrder: string[] = [];

  private constructor(
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly cdp: CDPSession,
    timeoutMs: number,
  ) {
    this.timeoutMs = timeoutMs;
  }

  static async launch(options: PlaywrightEngineOptions): Promise<PlaywrightEngine> {
    const browser = await chromium.launch({
      executablePath: options.executablePath,
      headless: options.headless ?? true,
      args: options.launchArgs ?? [],
    });

    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);

    const engine = new PlaywrightEngine(browser, page, cdp, options.timeoutMs ?? 30_000);

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) engine.doc += 1;
    });

    void cdp.send("Network.enable").catch(() => {});
    cdp.on("Network.requestWillBeSent", (event) => {
      engine.recordRequest(event as unknown as RequestEvent);
    });
    cdp.on("Network.responseReceived", (event) => {
      engine.recordResponse(event as unknown as ResponseEvent);
    });

    return engine;
  }

  async navigate(url: string): Promise<NavigateResult> {
    try {
      const response = await this.page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.timeoutMs,
      });

      return {
        url: this.page.url(),
        title: await this.page.title(),
        status: response?.status() ?? null,
      };
    } catch (error) {
      throw new EngineError("navigation_failed", `could not navigate to ${url}`, {
        cause: error,
      });
    }
  }

  async snapshot(): Promise<Snapshot> {
    const [ax, dom] = await Promise.all([
      this.cdp.send("Accessibility.getFullAXTree") as unknown as Promise<{
        nodes: RawAxNode[];
      }>,
      this.cdp.send("DOMSnapshot.captureSnapshot", {
        computedStyles: ["display", "visibility", "opacity"],
        includeDOMRects: true,
      }) as unknown as Promise<DomSnapshotResult>,
    ]);

    const layout = indexLayout(dom);

    return {
      doc: this.doc,
      v: this.v,
      url: this.page.url(),
      title: await this.page.title(),
      nodes: ax.nodes.map((node) => toSemanticNode(node, layout)),
    };
  }

  async dispatch(action: Action): Promise<DispatchResult> {
    const beforeUrl = this.page.url();
    const beforeDoc = this.doc;
    const networkMark = this.networkOrder.length;

    switch (action.do) {
      case "click":
        await this.click(action.backendNodeId);
        await this.settle();
        break;
      case "fill":
        await this.fill(action.backendNodeId, action.value);
        break;
      case "select":
        await this.select(action.backendNodeId, action.value);
        break;
      case "check":
        await this.setChecked(action.backendNodeId, true);
        await this.settle();
        break;
      case "uncheck":
        await this.setChecked(action.backendNodeId, false);
        await this.settle();
        break;
      case "press":
        await this.page.keyboard.press(action.key);
        await this.settle();
        break;
    }

    this.v += 1;
    const effects = this.effectsSince(networkMark, action, beforeUrl, beforeDoc);

    return {
      ok: true,
      doc: this.doc,
      v: this.v,
      url: this.page.url(),
      title: await this.page.title(),
      effects,
    };
  }

  async evaluate<T>(expression: string): Promise<T> {
    try {
      return (await this.page.evaluate(expression)) as T;
    } catch (error) {
      throw new EngineError("evaluate_failed", "page evaluation failed", {
        cause: error,
      });
    }
  }

  async close(): Promise<void> {
    try {
      await this.browser.close();
    } catch {
      // Closing an already-closed browser is a no-op.
    }
  }

  private async resolveObject(backendNodeId: number): Promise<string> {
    let resolved: ResolvedNode;

    try {
      resolved = (await this.cdp.send("DOM.resolveNode", {
        backendNodeId,
      })) as unknown as ResolvedNode;
    } catch (error) {
      throw new EngineError("not_found", `no DOM node with backend id ${backendNodeId}`, {
        cause: error,
      });
    }

    const objectId = resolved.object.objectId;
    if (objectId === undefined) {
      throw new EngineError("not_found", `no DOM node with backend id ${backendNodeId}`);
    }

    return objectId;
  }

  private async callOn<T>(
    objectId: string,
    functionDeclaration: string,
    args: Array<{ value: unknown }>,
  ): Promise<T> {
    const response = (await this.cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: args,
      returnByValue: true,
    })) as unknown as CallResult;

    if (response.exceptionDetails !== undefined) {
      throw new EngineError(
        "evaluate_failed",
        response.exceptionDetails.text ?? "callFunctionOn failed",
      );
    }

    return response.result.value as T;
  }

  private effectsSince(
    mark: number,
    action: Action,
    beforeUrl: string,
    beforeDoc: number,
  ): Effect[] {
    const effects: Effect[] = [];

    if (this.doc !== beforeDoc || this.page.url() !== beforeUrl) {
      effects.push({
        kind: "navigation",
        from: beforeUrl,
        to: this.page.url(),
        doc: this.doc,
      });
    }

    for (const requestId of this.networkOrder.slice(mark)) {
      const effect = this.network.get(requestId);
      if (effect !== undefined) effects.push(effect);
    }

    if (action.do === "fill" || action.do === "select") {
      effects.push({
        kind: "value",
        backendNodeId: action.backendNodeId,
        value: action.value,
      });
    }

    return effects;
  }

  private recordRequest(event: RequestEvent): void {
    this.network.set(event.requestId, {
      kind: "network",
      method: event.request.method,
      url: event.request.url,
    });
    this.networkOrder.push(event.requestId);

    if (this.networkOrder.length > 500) {
      const oldest = this.networkOrder.shift();
      if (oldest !== undefined) this.network.delete(oldest);
    }
  }

  private recordResponse(event: ResponseEvent): void {
    const effect = this.network.get(event.requestId);
    if (effect !== undefined) effect.status = event.response.status;
  }

  private async click(backendNodeId: number): Promise<void> {
    const objectId = await this.resolveObject(backendNodeId);

    try {
      // Centre the node, not just bring it into view: a button at the bottom
      // edge has its centre outside the viewport, and the hit-test then lands
      // on whatever is at the clamped point.
      await this.callOn(
        objectId,
        `function () {
          if (typeof this.scrollIntoView === "function") {
            this.scrollIntoView({ block: "center", inline: "center" });
          }
        }`,
        [],
      );
    } catch {
      // A node without a layout box reports a zero rect below.
    }

    const rect = await this.callOn<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>(
      objectId,
      `function () {
        const r = this.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }`,
      [],
    );

    if (rect.width === 0 || rect.height === 0) {
      throw new EngineError("not_interactive", `node ${backendNodeId} has no layout box`);
    }

    const viewport = await this.evaluate<{
      width: number;
      height: number;
      scrollX: number;
      scrollY: number;
    }>(
      "({ width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY })",
    );

    // A button at the bottom edge cannot be centred when the page is already
    // scrolled to the end. Click the centre of the visible part instead.
    const left = Math.max(0, rect.x);
    const top = Math.max(0, rect.y);
    const right = Math.min(viewport.width, rect.x + rect.width);
    const bottom = Math.min(viewport.height, rect.y + rect.height);

    if (right <= left || bottom <= top) {
      throw new EngineError("not_interactive", `node ${backendNodeId} is outside the viewport`);
    }

    const x = Math.round((left + right) / 2);
    const y = Math.round((top + bottom) / 2);

    let hit: { backendNodeId?: number };

    try {
      // DOM.getNodeForLocation takes document coordinates; the mouse takes
      // viewport coordinates. Without the scroll offset a scrolled page
      // reports the node above the target as the blocker.
      hit = (await this.cdp.send("DOM.getNodeForLocation", {
        x: x + viewport.scrollX,
        y: y + viewport.scrollY,
        includeUserAgentShadowDOM: false,
      })) as unknown as { backendNodeId?: number };
    } catch (error) {
      throw new EngineError(
        "not_interactive",
        `hit-test failed at ${x},${y}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error, details: { x, y } },
      );
    }

    const blocker = hit.backendNodeId;

    if (blocker !== undefined && blocker !== backendNodeId) {
      const related =
        (await this.contains(backendNodeId, blocker)) ||
        (await this.ancestorsOf(backendNodeId)).has(blocker);

      if (!related) {
        throw new EngineError("not_interactive", `node ${backendNodeId} is covered by ${blocker}`, {
          details: { blockerBackendNodeId: blocker },
        });
      }
    }

    await this.page.mouse.click(x, y);
  }

  /**
   * Wait for the page to settle after an action.
   *
   * A click that submits a form starts a navigation asynchronously, so this
   * first waits up to 250ms for a main-frame navigation, then for load and a
   * short network-idle window. A long poll or animation must not block the
   * caller; the timeouts are the contract.
   */
  private async settle(): Promise<void> {
    const navigated = new Promise<void>((resolve) => {
      const onNavigated = (frame: Frame): void => {
        if (frame === this.page.mainFrame()) {
          this.page.off("framenavigated", onNavigated);
          resolve();
        }
      };

      this.page.on("framenavigated", onNavigated);
      setTimeout(() => {
        this.page.off("framenavigated", onNavigated);
        resolve();
      }, 250);
    });

    await navigated;
    await this.page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: 1_000 }).catch(() => {});
  }

  private async contains(target: number, candidate: number): Promise<boolean> {
    const described = (await this.cdp.send("DOM.describeNode", {
      backendNodeId: target,
      depth: -1,
    })) as unknown as { node: DescribedNode };

    return collectBackendIds(described.node).has(candidate);
  }

  private async ancestorsOf(backendNodeId: number): Promise<Set<number>> {
    const ids = new Set<number>([backendNodeId]);
    let current = backendNodeId;

    for (let depth = 0; depth < 8; depth += 1) {
      const described = (await this.cdp.send("DOM.describeNode", {
        backendNodeId: current,
        depth: 0,
      })) as unknown as { node: { parentId?: number } };

      const parentId = described.node.parentId;
      if (parentId === undefined) break;

      const parent = (await this.cdp.send("DOM.describeNode", {
        nodeId: parentId,
        depth: 0,
      })) as unknown as { node: { backendNodeId?: number } };

      const parentBackend = parent.node.backendNodeId;
      if (parentBackend === undefined) break;

      ids.add(parentBackend);
      current = parentBackend;
    }

    return ids;
  }

  private async fill(backendNodeId: number, value: string): Promise<void> {
    const objectId = await this.resolveObject(backendNodeId);

    const isFile = await this.callOn<boolean>(
      objectId,
      `function () {
        return this instanceof HTMLInputElement && this.type === "file";
      }`,
      [],
    );

    if (isFile) {
      await this.cdp.send("DOM.setFileInputFiles", {
        files: [value],
        backendNodeId,
      });
      return;
    }

    await this.callOn(
      objectId,
      `function () {
        if ("value" in this) {
          this.value = "";
        }
      }`,
      [],
    );

    await this.cdp.send("DOM.focus", { backendNodeId });
    await this.page.keyboard.insertText(value);
  }

  private async select(backendNodeId: number, value: string): Promise<void> {
    const objectId = await this.resolveObject(backendNodeId);

    await this.callOn(
      objectId,
      `function (value) {
        if (!(this instanceof HTMLSelectElement)) {
          throw new Error("target is not a select");
        }
        this.value = value;
        if (this.value !== value) {
          throw new Error("no option with value " + value);
        }
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
      }`,
      [{ value }],
    );
  }

  private async setChecked(backendNodeId: number, checked: boolean): Promise<void> {
    const objectId = await this.resolveObject(backendNodeId);

    await this.callOn(
      objectId,
      `function (checked) {
        if (!(this instanceof HTMLInputElement)) {
          throw new Error("target is not an input");
        }
        this.checked = checked;
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
      }`,
      [{ value: checked }],
    );
  }
}

function indexLayout(snapshot: DomSnapshotResult): Map<number, LayoutInfo> {
  const layout = new Map<number, LayoutInfo>();

  for (const document of snapshot.documents) {
    const nodes = document.nodes;
    const boxes = document.layout;

    boxes.nodeIndex.forEach((nodeIndex, position) => {
      const backendNodeId = nodes.backendNodeId[nodeIndex];
      const bounds = boxes.bounds[position];
      if (backendNodeId === undefined || bounds === undefined) return;

      const styles = boxes.styles?.[position];
      layout.set(backendNodeId, {
        bounds: {
          x: bounds[0] ?? 0,
          y: bounds[1] ?? 0,
          width: bounds[2] ?? 0,
          height: bounds[3] ?? 0,
        },
        display: styleValue(snapshot.strings, styles?.[0]),
        visibility: styleValue(snapshot.strings, styles?.[1]),
        opacity: styleValue(snapshot.strings, styles?.[2], "1"),
        test_id: testIdFor(nodes.attributes?.[nodeIndex], snapshot.strings),
      });
    });
  }

  return layout;
}

function styleValue(strings: string[], index: number | undefined, fallback = ""): string {
  if (index === undefined) return fallback;
  return strings[index] ?? fallback;
}

function testIdFor(attributes: number[] | undefined, strings: string[]): string | undefined {
  if (attributes === undefined) return undefined;

  for (let index = 0; index + 1 < attributes.length; index += 2) {
    const nameIndex = attributes[index];
    if (nameIndex === undefined) continue;
    if (strings[nameIndex] !== "data-testid") continue;

    const valueIndex = attributes[index + 1];
    return valueIndex === undefined ? undefined : strings[valueIndex];
  }

  return undefined;
}

function toSemanticNode(node: RawAxNode, layout: Map<number, LayoutInfo>): SemanticNode {
  const properties: Record<string, string | number | boolean> = {};

  for (const property of node.properties ?? []) {
    const value = property.value?.value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      properties[property.name] = value;
    }
  }

  const result: SemanticNode = {
    nodeId: node.nodeId,
    role: typeof node.role?.value === "string" ? node.role.value : "none",
    name: typeof node.name?.value === "string" ? node.name.value : String(node.name?.value ?? ""),
    ignored: node.ignored,
    visible: false,
    properties,
    childIds: node.childIds ?? [],
  };

  if (node.backendDOMNodeId === undefined) return result;

  result.backendNodeId = node.backendDOMNodeId;

  const info = layout.get(node.backendDOMNodeId);
  if (info === undefined) return result;

  if (info.test_id !== undefined) result.test_id = info.test_id;

  result.bounds = info.bounds;
  result.visible =
    !node.ignored &&
    info.bounds.width > 0 &&
    info.bounds.height > 0 &&
    info.display !== "none" &&
    info.visibility !== "hidden" &&
    info.visibility !== "collapse" &&
    Number(info.opacity) > 0;

  return result;
}

function collectBackendIds(node: DescribedNode, into = new Set<number>()): Set<number> {
  if (node.backendNodeId !== undefined) into.add(node.backendNodeId);

  for (const child of node.children ?? []) {
    collectBackendIds(child, into);
  }

  return into;
}
