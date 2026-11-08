import { type Browser, type CDPSession, chromium, type Page } from "playwright-core";

import {
  type Action,
  type DispatchResult,
  type Engine,
  EngineError,
  type NavigateResult,
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

type DomSnapshotResult = {
  strings: string[];
  documents: Array<{
    nodes: { backendNodeId: number[] };
    layout: { nodeIndex: number[]; bounds: number[][]; styles?: number[][] };
  }>;
};

type LayoutInfo = {
  bounds: { x: number; y: number; width: number; height: number };
  display: string;
  visibility: string;
  opacity: string;
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

    return new PlaywrightEngine(browser, page, cdp, options.timeoutMs ?? 30_000);
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
      url: this.page.url(),
      title: await this.page.title(),
      nodes: ax.nodes.map((node) => toSemanticNode(node, layout)),
    };
  }

  async dispatch(action: Action): Promise<DispatchResult> {
    switch (action.do) {
      case "click":
        await this.click(action.backendNodeId);
        break;
      case "fill":
        await this.fill(action.backendNodeId, action.value);
        break;
      case "select":
        await this.select(action.backendNodeId, action.value);
        break;
      case "check":
        await this.setChecked(action.backendNodeId, true);
        break;
      case "uncheck":
        await this.setChecked(action.backendNodeId, false);
        break;
      case "press":
        await this.page.keyboard.press(action.key);
        break;
    }

    return { ok: true, url: this.page.url(), title: await this.page.title() };
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

  private async click(backendNodeId: number): Promise<void> {
    const objectId = await this.resolveObject(backendNodeId);

    try {
      await this.cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId });
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

    await this.page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  }

  private async fill(backendNodeId: number, value: string): Promise<void> {
    const objectId = await this.resolveObject(backendNodeId);

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
      });
    });
  }

  return layout;
}

function styleValue(strings: string[], index: number | undefined, fallback = ""): string {
  if (index === undefined) return fallback;
  return strings[index] ?? fallback;
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
