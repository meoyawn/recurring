# Monorepo

Web 2.0 app

- [OpenAPI](packages/openapi/AGENTS.md)
- [golang echo http backend](apps/api/AGENTS.md)
- [typescript SolidStart](apps/web/AGENTS.md)
- [ansible](ops/ansible/AGENTS.md)
- [terraform](ops/terraform/AGENTS.md)

## Rules

- never format files. Leave it to humans
- never `git commit` secrets or IPs. This repo is Open Source
- never run `bun patch`
- never run `task api:test` without escalating permissions (has docker calls
  inside)

## CLI

- never call `rg --files`, call `rg --files --hidden -u -g '!.git'` instead
- never use `bunx`, ask human to `bun i -d`, then use `bun`
- never put commands in `package.json`s. Put them in `Taskfile.yaml`s only
- never call `wc`, use `scc` instead

## Misc

- never skip reading
  https://github.com/quarylabs/sqruff/blob/main/crates/lib/src/core/default_config.cfg
  before editing `.sqruff`
