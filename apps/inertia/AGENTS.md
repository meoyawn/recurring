# AGENTS.md

- 100% TypeScript

## Rules

- Never start a dev server, it's already running
- Never edit `vitest.config.ts` it's not used right now

## HTTP API

- Never use plain `fetch()`, there's a generated client in [gen](gen/)

## UX

### Forms

- Never allow explicit form submits, always attempt to submit forms on blur.
  Never render form errors on fields that are not dirty. Reason:
  [Inertia version mismatches can reload stale clients and discard in-progress form input.](vite.config.ts)
