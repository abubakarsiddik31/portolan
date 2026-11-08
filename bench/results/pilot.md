# Pilot N=1 — arm C

16 scored rows, one per held-out template, using the scripted model.
The model is deterministic; this pilot validates the harness, not model quality.

| Arm | Runs | Templates | Success (95% CI) | $/completed (95% CI) | Steps/task (95% CI) |
|---|---:|---:|---|---|---|
| C | 16 | 16 | 100.0% (100.0–100.0) | $0.0000 ($0.0000–$0.0000) | 7.8 (6.4–9.3) |

## Arms not run

- **A (browser-use)**: blocked on `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
- **B (agent-browser)**: the harness test covers one store task; not part of this pilot.
- **D-oracle**: the held-out fixtures have no oracle maps yet.

Every row has `provider: scripted`, `model: scripted`, and `$0` cost. A real
pilot needs provider keys and a local model; this one is the harness check.
