# Monorepo

Web 2.0 app

- [OpenAPI](packages/openapi/AGENTS.md)
- [golang echo http backend](apps/api/AGENTS.md)
- [typescript SolidStart](apps/web/AGENTS.md)
- [ansible](ops/ansible/AGENTS.md)
- [terraform](ops/terraform/AGENTS.md)

## CLI

### Rules

- never call `rg --files`, call `rg --files --hidden -u -g '!.git'` instead
- never use `bunx`, ask human to `bun i -d`, then use `bun`
