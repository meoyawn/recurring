# OpenAPI contract

Source of truth: `spec/recurring.openapi.yaml`.

Generator version is pinned in `openapitools.json` (used by `@openapitools/openapi-generator-cli`).

- `config/ts-fetch.yaml` — TypeScript `fetch` client → `apps/inertia/gen/`
- `config/go-structs.yaml` — Go structs → `apps/api/internal/gen/openapi/`

Install dependencies from the repo root:

```bash
bun install
```

Run generation from this directory (so paths in the YAML and `openapitools.json` resolve correctly):

```bash
task generate:client
task generate:go-structs
```

From repo root via [Task](https://taskfile.dev):

```bash
task openapi:generate:client
task openapi:generate:go-structs
```

Requires a JRE (OpenAPI Generator runs on the JVM). Alternatively, use the Docker image `openapitools/openapi-generator-cli` with the same `-c` files and mounted workspace paths.
