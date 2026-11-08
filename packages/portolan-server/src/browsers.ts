export type Closable = {
  close(): Promise<void> | void;
};

/**
 * Tracks the browser resources owned by sessions.
 *
 * The runtime's substrate factory may create one engine per session. Register
 * it here so a graceful shutdown can close every one, and so a session close
 * can release its browser without waiting for the process to exit.
 */
export class BrowserRegistry {
  private readonly engines = new Map<string, Closable>();

  register(sid: string, engine: Closable): void {
    this.engines.set(sid, engine);
  }

  unregister(sid: string): void {
    this.engines.delete(sid);
  }

  size(): number {
    return this.engines.size;
  }

  async close(sid: string): Promise<void> {
    const engine = this.engines.get(sid);
    if (engine === undefined) return;
    this.engines.delete(sid);
    await engine.close();
  }

  async closeAll(): Promise<void> {
    const engines = [...this.engines.values()];
    this.engines.clear();
    // The async wrapper turns a synchronous throw into a rejection, so one bad
    // engine cannot stop the others from closing.
    await Promise.allSettled(
      engines.map(async (engine) => {
        await engine.close();
      }),
    );
  }
}
