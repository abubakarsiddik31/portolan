# Security Policy

Portolan drives real browsers against real accounts. A security bug here can
move money, leak credentials, or let page content steer an agent. Treat it that
way.

## Supported versions

Portolan is pre-1.0. Security fixes land on `main`; there are no maintained
release branches yet. The latest commit on `main` is the supported version.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting
(Security → Report a vulnerability) or email the maintainer at the address on
the repository owner's GitHub profile.

Include:

- what you can do that you should not be able to do;
- the smallest reproduction you have (a map, a trace, a request, a fixture);
- affected version or commit;
- whether credentials, writes, or egress are involved.

We aim to acknowledge within 3 business days and to ship a fix or mitigation
within 30 days for confirmed issues. We will credit you unless you ask us not
to.

## Scope

- The runtime, protocol, map format, MCP server, compiler, and skills generator.
- Credential handling, egress policy, write safety, and untrusted page content.
- Dependency and supply-chain issues in the default path.

## Out of scope

- Vulnerabilities in the sites Portolan drives.
- CAPTCHA or anti-bot evasion (Portolan returns `blocked`; it does not evade).
- Self-XSS in the benchmark fixtures; they are test apps, not products.

## Design commitments

These are invariants, not aspirations:

1. **Maps are declarative.** No arbitrary code execution from a map, a trace, or
   a generated skill.
2. **Credentials never live in maps, traces, skills, logs, or model prompts.**
3. **Page text is untrusted data, never instructions.** It is labeled as data in
   MCP results and cannot create ops at runtime.
4. **Irreversible writes require explicit confirmation** and an outcome check.
   A write with an unknown outcome is never retried automatically.
5. **Community maps are reviewed and signed** before they are marked verified.
