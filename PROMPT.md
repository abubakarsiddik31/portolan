# Prompt to paste into an AI coding tool

Copy the block below into Claude Code, Codex, Cursor, or Gemini CLI to set up or
restructure the Portolan documentation site.

---

You are working in the `portolan` repository. Maintain a user-facing
documentation site with VitePress, deployed to GitHub Pages.

Requirements:

1. `website/` contains a VitePress site configured for GitHub Pages:
   - `base: '/portolan/'`, title `Portolan`, and repo
     `https://github.com/abubakarsiddik31/portolan`.
   - Logo and favicon live in `website/public/` and are referenced from
     `.vitepress/config.mts` and the home page.
2. Keep the user-facing information architecture:
   - `guide/`: what-is-portolan, quickstart, clients, concepts, using-maps,
     write-safety, skills, compiling-maps.
   - `reference/`: mcp-tools, cli, configuration, map-format.
   - `project/`: vision, architecture, security, benchmark, licensing.
   - Do not expose internal planning docs (build plans, project plans,
     interviews, vertical scoring) in the sidebar.
3. The home page uses `layout: home` with a hero, actions, and feature cards.
4. Add `public/llms.txt` (and a root-level `llms.txt`) with the canonical docs
   URLs, and keep them in sync when pages change.
5. Add a GitHub Actions workflow at `.github/workflows/docs.yml` that installs
   dependencies, builds VitePress, and deploys to GitHub Pages on push to
   `main` and on `workflow_dispatch`.
6. Run `scripts/escape-angles.mjs` before the build so VitePress can render
   prose that contains angle-bracket pseudo-types.
7. Verify with `npm run docs:build --prefix website` (must pass).
8. Do not modify application code; only docs, website assets, and workflow
   files.

Return: the Pages URL, the build command, and the files changed.
