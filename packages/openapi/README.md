# OpenAPI contract

Source of truth: `spec/recurring.openapi.yaml`.

Generator version is pinned in `openapitools.json` (used by `@openapitools/openapi-generator-cli`).

- `config/client.yaml` — TypeScript `fetch` client → `apps/web/gen/`
- `config/server-stubs.yaml` — Go server scaffolding → `apps/api/gen/` (merge carefully with real handlers in `apps/api/internal`)

Run from this directory (so paths in the YAML and `openapitools.json` resolve correctly):

```bash
bun install
bun run generate:client
bun run generate:server-stubs
```

From repo root via [Task](https://taskfile.dev):

```bash
task openapi:gen:client
task openapi:gen:server-stubs
```

Requires a JRE (OpenAPI Generator runs on the JVM). Alternatively, use the Docker image `openapitools/openapi-generator-cli` with the same `-c` files and mounted workspace paths.
