# Brochure deployment (Vercel)

This directory exists **only** so a second Vercel project can select the
`brochure` surface via its **Root Directory** setting — no dashboard environment
variables required. The surface is baked into `vercel.json` here.

The **portfolio** project is unchanged: it uses the repo-root `vercel.json`
(Root Directory = repo root) and builds `VITE_DEPLOYMENT_SURFACE=portfolio`.

## One-time Vercel setup for the brochure

1. Vercel → **Add New → Project** → import `harshit259999/words-of-word`.
2. **Settings → Build & Development → Root Directory** = `deploy/brochure`.
3. Enable **"Include files outside the root directory in the Build Step"**
   (required — the build reaches up into the monorepo).
4. Leave build/install/output empty (this folder's `vercel.json` sets them).
5. **Settings → Domains** → add e.g. `brochure.wordsofword.in`.
6. Deploy.

Both projects track `main`, so every push auto-deploys both — each builds its
own surface. To spin up more surfaces later, copy this folder and change
`VITE_DEPLOYMENT_SURFACE`.

## How it works

- `installCommand` / `buildCommand` `cd ../..` to the repo root and run the
  normal monorepo build.
- Output is copied to `deploy/brochure/dist` and exposed via
  `outputDirectory: "dist"` (kept inside the Root Directory so Vercel is happy).
- `dist/` is git-ignored.
