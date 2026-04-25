# Monorepo

Web 2.0 app

- [OpenAPI](packages/openapi/README.md)
- [golang echo http backend](apps/api/README.md)
- [typescript SolidStart](apps/web/README.md)
- [ansible](ops/ansible/README.md)
- [terraform](ops/terraform/README.md)

## CLI

### Rules

- never call `rg --files`, call `rg --files --hidden -g '!.git'` instead
- never use `bunx`, ask human to `bun i -d`, then use `bun`
