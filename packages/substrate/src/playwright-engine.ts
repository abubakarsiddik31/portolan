import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type CDPSession,
  chromium,
  type Frame,
  type Page,
} from "playwright-core";

import {
  type Action,
  type DispatchResult,
  type DownloadInfo,
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
  /**
   * Cookies and localStorage from a signed-in session, as a Playwright storage
   * state file or object. The user signs in once; Portolan never sees the
   * password.
   */
  storageState?: BrowserContextOptions["storageState"];
  /**
   * Abort every request whose method can change server state (anything but
   * GET, HEAD, and OPTIONS). A read-only guard that holds whatever the page's
   * own script tries. Apps that read over POST, such as GraphQL, need it off.
   */
  readOnly?: boolean;
  /**
   * Tags the browser's command line so `reapOrphans` can find it after this
   * process dies without a graceful close.
   */
  instanceId?: string;
  /**
   * Run in a fresh context of an already launched browser instead of
   * launching one. `close()` then closes only the context, so many isolated
   * runs share one Chrome process.
   */
  browser?: BrowserHandle;
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
  request: { method: string; url: string; postData?: string; hasPostData?: boolean };
  type?: string;
};

type RequestBodyResult = {
  postData: string;
};

type ResponseEvent = {
  requestId: string;
  response: { status: number; mimeType?: string };
};

type LoadingFinishedEvent = {
  requestId: string;
};

type ResponseBodyResult = {
  body: string;
  base64Encoded: boolean;
};

/** A body larger than this is not worth carrying into a trace. */
const MAX_BODY_CHARS = 256 * 1024;

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
};

type SnapshotIndex = {
  layout: Map<number, LayoutInfo>;
  attributes: Map<number, Record<string, string>>;
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

/** Background work an automated session never needs; each Chrome costs memory. */
const LEAN_ARGS = [
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--mute-audio",
  "--no-first-run",
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * One Chrome process that several engines can open contexts in. Every launch
 * of the real Chrome costs a process, so a run that needs many isolated
 * sessions should launch once and open a context per run.
 */
export class BrowserHandle {
  private constructor(readonly browser: Browser) {}

  static async launch(
    options: Pick<
      PlaywrightEngineOptions,
      "executablePath" | "headless" | "launchArgs" | "instanceId"
    >,
  ): Promise<BrowserHandle> {
    const args = [...LEAN_ARGS, ...(options.launchArgs ?? [])];
    if (options.instanceId !== undefined) {
      args.push(`--portolan-instance=${options.instanceId}`);
    }

    return new BrowserHandle(
      await chromium.launch({
        executablePath: options.executablePath,
        headless: options.headless ?? true,
        args,
      }),
    );
  }

  async close(): Promise<void> {
    try {
      await this.browser.close();
    } catch {
      // Closing an already-closed browser is a no-op.
    }
  }
}

export class PlaywrightEngine implements Engine {
  private readonly timeoutMs: number;
  private doc = 0;
  private v = 0;
  private readonly network = new Map<string, NetworkEffect>();
  private networkOrder: string[] = [];
  private readonly networkSeqOf = new Map<string, number>();
  private networkSeq = 0;
  private readonly requestCaptures = new Map<string, Promise<void>>();
  private readonly responseCaptures = new Map<string, Promise<void>>();
  private downloadStarted = false;
  private downloadPromise: Promise<DownloadInfo | undefined> | undefined;
  private lastDownload: DownloadInfo | undefined;
  private downloadWaiters: Array<(info: DownloadInfo | undefined) => void> = [];

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly cdp: CDPSession,
    timeoutMs: number,
    private readonly ownsBrowser: boolean,
  ) {
    this.timeoutMs = timeoutMs;
  }

  static async launch(options: PlaywrightEngineOptions): Promise<PlaywrightEngine> {
    const ownsBrowser = options.browser === undefined;
    const handle = options.browser ?? (await BrowserHandle.launch(options));
    const browser = handle.browser;

    let context: BrowserContext | undefined;
    let page: Page;
    let cdp: CDPSession;
    let downloadDir: string;
    try {
      context = await browser.newContext({
        acceptDownloads: true,
        ...(options.storageState !== undefined ? { storageState: options.storageState } : {}),
      });
      if (options.readOnly === true) {
        await context.route("**/*", (route) =>
          SAFE_METHODS.has(route.request().method())
            ? route.continue()
            : route.abort("blockedbyclient"),
        );
      }
      page = await context.newPage();
      cdp = await context.newCDPSession(page);
      downloadDir = await mkdtemp(join(tmpdir(), "portolan-download-"));
    } catch (error) {
      // A bad storage state or a failed page must not leave Chrome running.
      if (ownsBrowser) await browser.close().catch(() => {});
      else await context?.close().catch(() => {});
      throw error;
    }

    const engine = new PlaywrightEngine(
      browser,
      context,
      page,
      cdp,
      options.timeoutMs ?? 30_000,
      ownsBrowser,
    );

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) engine.doc += 1;
    });

    page.on("download", (download) => {
      engine.downloadStarted = true;
      engine.downloadPromise = (async () => {
        const filename = download.suggestedFilename();
        const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const target = join(downloadDir, `${Date.now()}-${safe}`);
        await download.saveAs(target);
        const info = { path: target, filename };
        engine.lastDownload = info;
        for (const resolve of engine.downloadWaiters.splice(0)) resolve(info);
        return info;
      })();
    });

    void cdp.send("Network.enable").catch(() => {});
    cdp.on("Network.requestWillBeSent", (event) => {
      engine.recordRequest(event as unknown as RequestEvent);
    });
    cdp.on("Network.responseReceived", (event) => {
      engine.recordResponse(event as unknown as ResponseEvent);
    });
    cdp.on("Network.loadingFinished", (event) => {
      engine.captureBody(event as unknown as LoadingFinishedEvent);
    });

    return engine;
  }

  /**
   * Run a script against the Playwright page itself. This is the escape hatch
   * for a sign-in the semantic verbs cannot drive; nothing else uses it.
   */
  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    return fn(this.page);
  }

  /** Save the signed-in session so another run can reuse it. */
  /** The current main-frame URL, without a snapshot. */
  url(): string {
    return this.page.url();
  }

  async storageState(path?: string): Promise<Awaited<ReturnType<BrowserContext["storageState"]>>> {
    return this.context.storageState(path === undefined ? undefined : { path });
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
      // A client-side redirect aborts the initial navigation with ERR_ABORTED
      // even though a real document is now loaded. Keep the page we landed on;
      // a DNS/connection failure or a timeout still fails.
      const current = this.page.url();
      const aborted =
        error instanceof Error && /ERR_ABORTED|frame was detached|interrupted/i.test(error.message);

      if (aborted && /^https?:/.test(current) && current !== "about:blank") {
        return {
          url: current,
          title: await this.page.title().catch(() => ""),
          status: null,
        };
      }

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

    const index = indexSnapshot(dom);

    return {
      doc: this.doc,
      v: this.v,
      url: this.page.url(),
      title: await this.page.title(),
      nodes: ax.nodes.map((node) => toSemanticNode(node, index.layout, index.attributes)),
    };
  }

  async dispatch(action: Action): Promise<DispatchResult> {
    const beforeUrl = this.page.url();
    const beforeDoc = this.doc;
    const networkMark = this.networkSeq;
    this.downloadStarted = false;
    this.downloadPromise = undefined;
    this.lastDownload = undefined;

    switch (action.do) {
      case "click":
        await this.settleAction(() => this.click(action.backendNodeId));
        break;
      case "fill":
        await this.fill(action.backendNodeId, action.value);
        break;
      case "select":
        await this.select(action.backendNodeId, action.value);
        break;
      case "check":
        await this.settleAction(() => this.setChecked(action.backendNodeId, true));
        break;
      case "uncheck":
        await this.settleAction(() => this.setChecked(action.backendNodeId, false));
        break;
      case "press":
        if (action.backendNodeId !== undefined) {
          await this.focus(action.backendNodeId);
        }
        await this.settleAction(() => this.page.keyboard.press(action.key));
        break;
    }

    await this.finishNetwork(networkMark);

    this.v += 1;
    const effects = this.effectsSince(networkMark, action, beforeUrl, beforeDoc);
    // A site often fetches a PDF and then clicks a blob link, so the download
    // starts after the action returns. Wait when the action fetched something
    // that looks like a file, not on every click.
    const downloadLike = effects.some(
      (effect) =>
        effect.kind === "network" &&
        (effect.mime_type?.includes("pdf") === true ||
          effect.mime_type?.includes("octet-stream") === true ||
          /\/pdf(\?|$)/.test(effect.url)),
    );
    const download =
      this.downloadStarted || downloadLike ? await this.waitForDownload(3_000) : undefined;

    return {
      ok: true,
      doc: this.doc,
      v: this.v,
      url: this.page.url(),
      title: await this.page.title(),
      effects,
      ...(download !== undefined ? { download } : {}),
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

  async screenshot(): Promise<Uint8Array> {
    return this.page.screenshot({ type: "png" });
  }

  async close(): Promise<void> {
    try {
      if (this.ownsBrowser) await this.browser.close();
      else await this.context.close();
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

    for (const requestId of this.networkOrder) {
      const seq = this.networkSeqOf.get(requestId);
      if (seq === undefined || seq < mark) continue;

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
    const effect: NetworkEffect = {
      kind: "network",
      method: event.request.method,
      url: event.request.url,
    };

    if (event.type !== undefined) effect.resource_type = event.type;

    if (event.request.postData !== undefined) {
      const body = parseJsonBody(event.request.postData);
      if (body !== undefined) effect.request_body = body;
    } else if (event.request.hasPostData === true) {
      this.captureRequestBody(event.requestId, effect);
    }

    this.network.set(event.requestId, effect);
    this.networkOrder.push(event.requestId);
    this.networkSeqOf.set(event.requestId, this.networkSeq);
    this.networkSeq += 1;

    if (this.networkOrder.length > 500) {
      const oldest = this.networkOrder.shift();
      if (oldest !== undefined) {
        this.network.delete(oldest);
        this.networkSeqOf.delete(oldest);
      }
    }
  }

  private recordResponse(event: ResponseEvent): void {
    const effect = this.network.get(event.requestId);
    if (effect === undefined) return;

    effect.status = event.response.status;
    if (event.response.mimeType !== undefined) effect.mime_type = event.response.mimeType;
  }

  /**
   * CDP only inlines a small request body in `requestWillBeSent`; a larger one
   * has to be asked for by id. This is the body a lifted write needs to replay.
   */
  private captureRequestBody(requestId: string, effect: NetworkEffect): void {
    const capture = (async () => {
      try {
        const result = (await this.cdp.send("Network.getRequestPostData", {
          requestId,
        })) as unknown as RequestBodyResult;

        const body = parseJsonBody(result.postData);
        if (body !== undefined) effect.request_body = body;
      } catch {
        // The body was already evicted; the effect is still attributed.
      }
    })();

    this.requestCaptures.set(requestId, capture);
    void capture.finally(() => {
      this.requestCaptures.delete(requestId);
    });
  }

  /**
   * Fetch a JSON response body while CDP still holds it.
   *
   * `loadingFinished` is the last moment the body is guaranteed to be
   * available, so the capture starts there and the action awaits it before
   * returning effects.
   */
  private captureBody(event: LoadingFinishedEvent): void {
    const effect = this.network.get(event.requestId);
    if (effect === undefined || !isJsonMime(effect.mime_type)) return;

    const capture = (async () => {
      try {
        const result = (await this.cdp.send("Network.getResponseBody", {
          requestId: event.requestId,
        })) as unknown as ResponseBodyResult;

        const text = result.base64Encoded
          ? Buffer.from(result.body, "base64").toString("utf8")
          : result.body;

        const body = parseJsonBody(text);
        if (body !== undefined) effect.response_body = body;
      } catch {
        // Redirects and evicted bodies have no readable body; status remains.
      }
    })();

    this.responseCaptures.set(event.requestId, capture);
    void capture.finally(() => {
      this.responseCaptures.delete(event.requestId);
    });
  }

  /** Wait for the body captures that belong to the action starting at `mark`. */
  private async finishNetwork(mark: number): Promise<void> {
    const pending: Promise<void>[] = [];

    for (const requestId of this.networkOrder) {
      const seq = this.networkSeqOf.get(requestId);
      if (seq === undefined || seq < mark) continue;

      const request = this.requestCaptures.get(requestId);
      if (request !== undefined) pending.push(request);

      const response = this.responseCaptures.get(requestId);
      if (response !== undefined) pending.push(response);
    }

    await Promise.all(pending);
  }

  /** Focus a node before a key press. */
  private async focus(backendNodeId: number): Promise<void> {
    const objectId = await this.resolveObject(backendNodeId);
    await this.assertEnabled(objectId, backendNodeId);

    try {
      await this.callOn(
        objectId,
        `function () {
          if (typeof this.scrollIntoView === "function") {
            this.scrollIntoView({ block: "center", inline: "center" });
          }
          if (typeof this.focus === "function") {
            this.focus();
          }
        }`,
        [],
      );
    } catch {
      // A node without focus support still receives the key press.
    }
  }

  /**
   * A disabled control is not clickable.
   *
   * Tailwind's `disabled:pointer-events-none` makes the hit-test land on the
   * element behind the button, so without this check a disabled button is
   * reported as "covered" by an opaque node id. The caller needs to know the
   * control is disabled, not that something covers it.
   */
  private async assertEnabled(objectId: string, backendNodeId: number): Promise<void> {
    const disabled = await this.callOn<boolean>(
      objectId,
      `function () {
        if ("disabled" in this && this.disabled === true) return true;
        return this.getAttribute?.("aria-disabled") === "true";
      }`,
      [],
    );

    if (disabled) {
      throw new EngineError("disabled", `node ${backendNodeId} is disabled`);
    }
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
      throw new EngineError("not_interactive", `node ${backendNodeId} has no layout box`, {
        details: { reason: "no_layout_box" },
      });
    }

    await this.assertEnabled(objectId, backendNodeId);

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
      throw new EngineError("not_interactive", `node ${backendNodeId} is outside the viewport`, {
        details: { reason: "outside_viewport" },
      });
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
        { cause: error, details: { x, y, reason: "hit_test_failed" } },
      );
    }

    const blocker = hit.backendNodeId;

    if (blocker !== undefined && blocker !== backendNodeId) {
      const related =
        (await this.contains(backendNodeId, blocker)) ||
        (await this.ancestorsOf(backendNodeId)).has(blocker);

      if (!related) {
        const info = await this.describeBackend(blocker);
        throw new EngineError("not_interactive", `node ${backendNodeId} is covered by ${blocker}`, {
          details: {
            blockerBackendNodeId: blocker,
            ...(info.tag !== undefined ? { blockerTag: info.tag } : {}),
            ...(info.domId !== undefined ? { blockerDomId: info.domId } : {}),
            ...(info.className !== undefined ? { blockerClass: info.className } : {}),
            ...(info.text !== undefined ? { blockerText: info.text } : {}),
          },
        });
      }
    }

    await this.page.mouse.click(x, y);
  }

  /**
   * Run an action that may navigate, and wait for the new document.
   *
   * The navigation waiter is installed *before* the action: a click can start
   * and commit a navigation before a listener installed afterwards runs, and
   * then the caller snapshots the old page. A non-navigating click (a modal,
   * a menu) resolves after a short cap instead of the full timeout. We do not
   * wait for networkidle: Playwright defines it as 500ms of quiet, which adds
   * half a second to every click. `dispatch` awaits the requests it captured,
   * and an op that needs a later state declares `await_state`.
   */
  private async settleAction(action: () => Promise<void>): Promise<void> {
    const navigated = new Promise<void>((resolve) => {
      const onNavigated = (frame: Frame): void => {
        if (frame === this.page.mainFrame()) {
          this.page.off("framenavigated", onNavigated);
          resolve();
        }
      };

      // Install the listener before the action: a click can commit a
      // navigation before a listener installed afterwards runs.
      this.page.on("framenavigated", onNavigated);
      setTimeout(() => {
        this.page.off("framenavigated", onNavigated);
        resolve();
      }, 500);
    });

    await action();
    await navigated;
    await this.page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
  }

  /** DOM facts about a node, for a blocker that has no semantic ref. */
  private async describeBackend(backendNodeId: number): Promise<{
    tag?: string;
    domId?: string;
    className?: string;
    text?: string;
  }> {
    try {
      const resolved = (await this.cdp.send("DOM.resolveNode", {
        backendNodeId,
      })) as unknown as ResolvedNode;
      const objectId = resolved.object.objectId;
      if (objectId === undefined) return {};

      return await this.callOn<{
        tag?: string;
        domId?: string;
        className?: string;
        text?: string;
      }>(
        objectId,
        `function () {
          const text = String(this.textContent ?? "").trim().replace(/\\s+/g, " ").slice(0, 80);
          return {
            tag: this.tagName,
            domId: this.id || undefined,
            className: typeof this.className === "string" ? this.className.slice(0, 80) : undefined,
            text: text || undefined,
          };
        }`,
        [],
      );
    } catch {
      return {};
    }
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

  /**
   * Set files on a file input.
   *
   * A styled "Choose file" control is usually a button or label, with the
   * real `<input type="file">` hidden nearby. Setting files on the button does
   * nothing, so fall back to the first file input on the page.
   */
  async setFiles(backendNodeId: number, files: string[]): Promise<void> {
    const objectId = await this.resolveObject(backendNodeId);

    const isFile = await this.callOn<boolean>(
      objectId,
      `function () {
        return this instanceof HTMLInputElement && this.type === "file";
      }`,
      [],
    );

    if (isFile) {
      await this.cdp.send("DOM.setFileInputFiles", { files, backendNodeId });
      return;
    }

    const document = (await this.cdp.send("DOM.getDocument", { depth: 0 })) as unknown as {
      root: { nodeId: number };
    };
    const found = (await this.cdp.send("DOM.querySelector", {
      nodeId: document.root.nodeId,
      selector: 'input[type="file"]',
    })) as unknown as { nodeId?: number };

    if (found.nodeId === undefined || found.nodeId === 0) {
      throw new EngineError("file_input_not_found", "no file input on the page");
    }

    const described = (await this.cdp.send("DOM.describeNode", {
      nodeId: found.nodeId,
      depth: 0,
    })) as unknown as { node?: { backendNodeId?: number } };

    const target = described.node?.backendNodeId;
    if (target === undefined) {
      throw new EngineError("file_input_not_found", "no file input on the page");
    }

    await this.cdp.send("DOM.setFileInputFiles", { files, backendNodeId: target });
  }

  /** Wait for a download that starts after the action returns. */
  private async waitForDownload(ms: number): Promise<DownloadInfo | undefined> {
    if (this.lastDownload !== undefined) {
      const info = this.lastDownload;
      this.lastDownload = undefined;
      return info;
    }

    if (this.downloadPromise !== undefined) {
      return Promise.race([
        this.downloadPromise,
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
      ]);
    }

    return new Promise((resolve) => {
      const waiter = (info: DownloadInfo | undefined): void => {
        clearTimeout(timer);
        this.downloadWaiters = this.downloadWaiters.filter((candidate) => candidate !== waiter);
        resolve(info);
      };
      const timer = setTimeout(() => {
        this.downloadWaiters = this.downloadWaiters.filter((candidate) => candidate !== waiter);
        resolve(undefined);
      }, ms);
      this.downloadWaiters.push(waiter);
    });
  }

  /** The current value of a form control, for a ref read. */
  async readValue(backendNodeId: number): Promise<string | undefined> {
    const objectId = await this.resolveObject(backendNodeId);

    return this.callOn<string | undefined>(
      objectId,
      `function () {
        if (
          this instanceof HTMLInputElement ||
          this instanceof HTMLTextAreaElement ||
          this instanceof HTMLSelectElement
        ) {
          return this.value;
        }
        if (this.getAttribute?.("role") === "combobox") {
          return (this.textContent ?? "").trim();
        }
        const aria = this.getAttribute?.("aria-valuetext") ?? this.getAttribute?.("aria-valuenow");
        return aria === null || aria === undefined ? undefined : String(aria);
      }`,
      [],
    );
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

    await this.cdp.send("DOM.focus", { backendNodeId }).catch(() => {
      throw new EngineError("not_interactive", `node ${backendNodeId} is not focusable`, {
        details: { reason: "not_focusable" },
      });
    });
    await this.page.keyboard.insertText(value).catch(() => {
      throw new EngineError("not_interactive", `node ${backendNodeId} did not accept text`, {
        details: { reason: "not_focusable" },
      });
    });
  }

  private async select(backendNodeId: number, value: string): Promise<void> {
    const objectId = await this.resolveObject(backendNodeId);

    const native = await this.callOn<boolean>(
      objectId,
      `function () { return this instanceof HTMLSelectElement; }`,
      [],
    );

    if (!native) {
      await this.selectCustom(backendNodeId, value);
      return;
    }

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

  /**
   * Choose an option in a custom combobox.
   *
   * React component libraries (Radix, shadcn, Headless UI) render a button
   * with `role="combobox"` and a portal listbox, not a native `<select>`.
   * Setting `.value` does nothing there. Open the control, find the option by
   * its visible text, and click its centre.
   */
  private async selectCustom(backendNodeId: number, value: string): Promise<void> {
    await this.click(backendNodeId);
    await this.page.waitForTimeout(200);

    const found = await this.evaluate<{
      point?: { x: number; y: number };
      options: string[];
    }>(
      `(() => {
        const wanted = ${JSON.stringify(value)}.toLowerCase();
        const options = Array.from(document.querySelectorAll('[role="option"]'));
        const names = options.map((node) => (node.textContent ?? "").trim());
        const exact = options.find(
          (node) => (node.textContent ?? "").trim().toLowerCase() === wanted,
        );
        const match =
          exact ??
          options.find((node) => (node.textContent ?? "").trim().toLowerCase().includes(wanted));
        if (!match) return { options: names };
        match.scrollIntoView({ block: "center", inline: "center" });
        const rect = match.getBoundingClientRect();
        return { point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, options: names };
      })()`,
    );

    if (found.point === undefined) {
      await this.page.keyboard.press("Escape").catch(() => {});
      throw new EngineError("option_not_found", `no option "${value}"`, {
        details: { options: found.options },
      });
    }

    await this.page.mouse.click(found.point.x, found.point.y);
    await this.page.waitForTimeout(150);
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

function parseJsonBody(text: string): unknown {
  if (text.length === 0 || text.length > MAX_BODY_CHARS) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isJsonMime(mime: string | undefined): boolean {
  return mime?.includes("json") === true;
}

function indexSnapshot(snapshot: DomSnapshotResult): SnapshotIndex {
  const layout = new Map<number, LayoutInfo>();
  const attributes = new Map<number, Record<string, string>>();

  for (const document of snapshot.documents) {
    const nodes = document.nodes;
    const boxes = document.layout;

    // Attributes exist for hidden nodes too, including closed-select options.
    nodes.backendNodeId.forEach((backendNodeId, index) => {
      const parsed = attributesFor(nodes.attributes?.[index], snapshot.strings);
      if (Object.keys(parsed).length > 0) attributes.set(backendNodeId, parsed);
    });

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

  return { layout, attributes };
}

function styleValue(strings: string[], index: number | undefined, fallback = ""): string {
  if (index === undefined) return fallback;
  return strings[index] ?? fallback;
}

function attributesFor(indices: number[] | undefined, strings: string[]): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (indices === undefined) return attributes;

  for (let index = 0; index + 1 < indices.length; index += 2) {
    const nameIndex = indices[index];
    const valueIndex = indices[index + 1];
    if (nameIndex === undefined || valueIndex === undefined) continue;

    const name = strings[nameIndex];
    const value = strings[valueIndex];
    if (name !== undefined && value !== undefined) attributes[name] = value;
  }

  return attributes;
}

function toSemanticNode(
  node: RawAxNode,
  layout: Map<number, LayoutInfo>,
  attributes: Map<number, Record<string, string>>,
): SemanticNode {
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

  const attrs = attributes.get(node.backendDOMNodeId);
  if (attrs !== undefined) {
    result.attributes = attrs;
    if (attrs["data-testid"] !== undefined) result.test_id = attrs["data-testid"];
  }

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

function collectBackendIds(node: DescribedNode, into = new Set<number>()): Set<number> {
  if (node.backendNodeId !== undefined) into.add(node.backendNodeId);

  for (const child of node.children ?? []) {
    collectBackendIds(child, into);
  }

  return into;
}
