/**
 * Where a site keeps the credential its own frontend sends with API calls.
 *
 * A map stores this reference, never the credential: the value is read from
 * the live page when a request is made, so a refreshed token keeps working
 * and nothing secret reaches `map.json`.
 */
export type HttpAuth =
  | { kind: "cookie" }
  | {
      kind: "bearer";
      /** Where the page keeps the token. */
      source: "localStorage" | "sessionStorage" | "cookie";
      /** The storage key or cookie name. */
      key: string;
      /** Dot path inside a JSON value, e.g. `state.token` for a persisted store. */
      path?: string;
      /** Request header the token travels in. Default `authorization`. */
      header?: string;
      /** Prefix before the token. Default `Bearer`; an empty string sends it bare. */
      scheme?: string;
    };

/** Where a token seen in a request header was found in the page. */
export type AuthSource = {
  header: string;
  scheme: string;
  source?: "localStorage" | "sessionStorage" | "cookie";
  key?: string;
  path?: string;
};

/**
 * Page script that finds which storage entry holds `token`. It returns the
 * location only; the token is compared inside the page and not returned.
 */
export function findAuthExpression(token: string): string {
  return `(() => {
    const token = ${JSON.stringify(token)};
    const dig = (value, path, depth) => {
      if (value === token) return path;
      if (depth > 4 || value === null || typeof value !== "object") return undefined;
      for (const [k, v] of Object.entries(value)) {
        const found = dig(v, path === "" ? k : path + "." + k, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const scan = (source, store) => {
      try {
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          const raw = store.getItem(key);
          if (raw === null) continue;
          if (raw === token) return { source, key };
          if (raw.length > 4 && (raw[0] === "{" || raw[0] === "[")) {
            try {
              const path = dig(JSON.parse(raw), "", 0);
              if (path !== undefined) return { source, key, path };
            } catch {}
          }
        }
      } catch {}
      return undefined;
    };
    const stored = scan("localStorage", window.localStorage) ?? scan("sessionStorage", window.sessionStorage);
    if (stored !== undefined) return stored;
    for (const pair of document.cookie.split(";")) {
      const at = pair.indexOf("=");
      if (at < 0) continue;
      if (decodeURIComponent(pair.slice(at + 1).trim()) === token) {
        return { source: "cookie", key: pair.slice(0, at).trim() };
      }
    }
    return null;
  })()`;
}

/**
 * Page script that reads the token a `bearer` auth points at.
 * It returns the header value to send, or null when the token is not there.
 */
export function readAuthExpression(auth: Extract<HttpAuth, { kind: "bearer" }>): string {
  const scheme = auth.scheme ?? "Bearer";
  return `(() => {
    const path = ${JSON.stringify(auth.path ?? "")};
    let raw = null;
    try {
      if (${JSON.stringify(auth.source)} === "cookie") {
        for (const pair of document.cookie.split(";")) {
          const at = pair.indexOf("=");
          if (at >= 0 && pair.slice(0, at).trim() === ${JSON.stringify(auth.key)}) {
            raw = decodeURIComponent(pair.slice(at + 1).trim());
          }
        }
      } else {
        raw = window[${JSON.stringify(auth.source)}].getItem(${JSON.stringify(auth.key)});
      }
    } catch {}
    if (raw === null || raw === undefined) return null;
    let token = raw;
    if (path !== "") {
      try {
        token = path.split(".").reduce((value, key) => value?.[key], JSON.parse(raw));
      } catch { return null; }
    }
    if (typeof token !== "string" || token === "") return null;
    return ${JSON.stringify(scheme)} === "" ? token : ${JSON.stringify(scheme)} + " " + token;
  })()`;
}
