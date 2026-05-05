# Web app

- [SolidStart](https://start.solidjs.com/)
- 100% TypeScript

## Rules

- Never use `node`, use `bun` for everything.
- Never start a dev server, it's already running
- Never skip running `task check` after editing `src/**/*`
- Never edit `gen/**/*`; run `task --dir "../../" openapi:generate:client`
  instead

## CF Workers

- Never let values in `.env.development` go out of sync with `wrangler.toml` and
  vice versa
- Never manually write types for `[vars]` in `wrangler.toml`, run
  `task cf:types` instead
- Never use `globalThis`, in CF workers
  [everything is passed in bindings](docs/dotenv.md)
