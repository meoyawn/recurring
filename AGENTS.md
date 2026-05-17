# Monorepo

Web 2.0 app

- [OpenAPI](packages/openapi/AGENTS.md)
- [golang echo http backend](apps/api/)
- [typescript Inertia frontend](apps/inertia/AGENTS.md)
- [ansible](ops/ansible/AGENTS.md)
- [terraform](ops/terraform/AGENTS.md)

## Rules

- never format files. Leave it to humans
- never `git commit` secrets or IPs (127.0.0.1 is ok to leak). This repo is Open
  Source
- never run `bun patch`
- never edit `.gitignore` without a human permission

## Domain

- never edit special ID/type contract files without syncing all of them:
  - `apps/shared-ts/src/ids.ts`
  - `apps/api/internal/domain/ids.go`
  - `packages/openapi/spec/recurring.responsible.ts`
  - `packages/openapi/config/recurring-ts-fetch.yaml`
  - `packages/openapi/config/go-structs.yaml`
  - `packages/openapi/templates/typescript-fetch/models.index.mustache`
  - `packages/openapi/templates/go-structs/ids.go.mustache`

## CLI

- never call `rg --files`, call `rg --files --hidden -u -g '!.git'` instead
- never use `bunx`, without a human permission
- never put commands in `package.json`s. Put them in `Taskfile.yaml`s only
- never call `wc`, use `scc` instead

## Misc

- never skip reading
  https://github.com/quarylabs/sqruff/blob/main/crates/lib/src/core/default_config.cfg
  before editing `.sqruff`
