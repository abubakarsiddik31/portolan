import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** A credential lookup, scoped to one site. */
export interface CredentialStore {
  get(site: string, key: string): Promise<string | undefined>;
}

/**
 * Environment-backed credentials.
 *
 * The variable is derived from the site and key: `PORTOLAN_STORE_API_KEY`.
 * A value for one site is never visible under another site's name.
 */
export class EnvCredentialStore implements CredentialStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async get(site: string, key: string): Promise<string | undefined> {
    const name = envName(site, key);
    const value = this.env[name];
    return value !== undefined && value.length > 0 ? value : undefined;
  }
}

export type KeychainRun = (command: string, args: string[]) => Promise<{ stdout: string }>;

export type KeychainOptions = {
  platform?: NodeJS.Platform;
  run?: KeychainRun;
};

const defaultRun: KeychainRun = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, { encoding: "utf8" });
  return { stdout };
};

/**
 * OS-keychain-backed credentials.
 *
 * macOS uses `security find-generic-password`; Linux uses `secret-tool lookup`.
 * The service and account are namespaced with the site, so a keychain entry
 * cannot be read under another site. A missing entry is `undefined`, not an
 * error.
 */
export class KeychainCredentialStore implements CredentialStore {
  private readonly platform: NodeJS.Platform;
  private readonly run: KeychainRun;

  constructor(options: KeychainOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.run = options.run ?? defaultRun;
  }

  async get(site: string, key: string): Promise<string | undefined> {
    try {
      if (this.platform === "darwin") {
        const { stdout } = await this.run("security", [
          "find-generic-password",
          "-s",
          `portolan:${site}:${key}`,
          "-w",
        ]);
        return nonEmpty(stdout);
      }

      if (this.platform === "linux") {
        const { stdout } = await this.run("secret-tool", [
          "lookup",
          "service",
          "portolan",
          "site",
          site,
          "key",
          key,
        ]);
        return nonEmpty(stdout);
      }
    } catch {
      return undefined;
    }

    return undefined;
  }
}

/** Env first, then the OS keychain. */
export class ChainCredentialStore implements CredentialStore {
  constructor(private readonly stores: CredentialStore[]) {}

  async get(site: string, key: string): Promise<string | undefined> {
    for (const store of this.stores) {
      const value = await store.get(site, key);
      if (value !== undefined) return value;
    }

    return undefined;
  }
}

export function createCredentialStore(env: NodeJS.ProcessEnv = process.env): CredentialStore {
  return new ChainCredentialStore([new EnvCredentialStore(env), new KeychainCredentialStore()]);
}

function envName(site: string, key: string): string {
  const suffix = `${site}_${key}`.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `PORTOLAN_${suffix}`;
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
