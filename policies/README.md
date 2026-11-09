# Egress policies

One file per site: `policies/<site>.json`. The guard is **default deny**.

```json
{
  "site": "store",
  "allow": ["shop.example.com", "api.example.com:443", "*.trusted.example"],
  "deny": ["ads.example.com"]
}
```

- `allow` patterns are a host (`shop.example.com`), a host and port
  (`api.example.com:443`), `*`, or a wildcard subdomain (`*.trusted.example`,
  which also matches `trusted.example`).
- `deny` is checked first. A denied host is recorded as `denied`; an unlisted
  host as `not_allowed`.
- A missing file returns `undefined`; an invalid file or a `site` mismatch
  throws.

## Use

```ts
const policy = loadPolicy("store");
const substrate = new Substrate(engine, {
  policy,
  onBlocked: (event) => log.warn(event),
});

await substrate.fetch({ method: "GET", url: "https://shop.example.com/cart" });
await substrate.goto("https://shop.example.com/checkout");
```

`EgressGuard.blockedRequests()` returns every block in order. The MCP
`substrateFactory` is the place to pass the policy for a session.

## What is covered

`Substrate.fetch` (the in-page `http` tier and fallback) and `Substrate.goto`
(the `url` tier) are guarded. `fetch` also checks the URL a redirect landed on
and refuses the response with `reason: "redirect"`. A page's own `location`
navigation or a form submission is not intercepted by this guard; blocking
those needs an engine request route, which is a separate layer.

The dev and held-out fixtures run on `127.0.0.1`, so their example policies
allow that host. A production policy should name the site's real hosts and
deny everything else by omission.
