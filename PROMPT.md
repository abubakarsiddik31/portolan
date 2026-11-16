# Prompt to paste into an AI coding tool

Copy the block below into Claude Code / Codex / Cursor / Gemini CLI to set up or extend the Portolan docs site.

---

You are working in the `portolan` repository. Create (or update) a documentation site using VitePress, deployed to GitHub Pages.

Requirements:
1. Create a `website/` directory with VitePress (latest) configured for GitHub Pages.
   - Set `base: '/portolan/'`, `title: 'Portolan'`, and the repo URL `https://github.com/abubakarsiddik31/portolan`.
2. Copy all files from `docs/` into `website/docs/` (preserve structure). Add an `index.md` home page and an `intro.md`.
3. Generate a sidebar in `.vitepress/config.mts` that lists every markdown file under the site.
4. Add `public/llms.txt` (and a root-level `llms.txt`) describing the project and linking to the docs.
5. Add a GitHub Actions workflow at `.github/workflows/docs.yml` that installs pnpm, builds VitePress, and deploys to GitHub Pages on push to `main` (and `workflow_dispatch`).
6. Add an escape step for angle brackets in markdown so VitePress builds: run `scripts/escape-angles.mjs` as a prebuild step.
7. Keep `ignoreDeadLinks: true` for cross-repo relative links.
8. Verify with `npm run docs:build --prefix website` (must pass).
9. Do not modify application code; only docs/website/workflow files.

Return: the Pages URL, the build command, and any files changed.
