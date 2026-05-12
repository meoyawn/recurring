# API

- Main backend
- [Go Echo](https://github.com/labstack/echo)
- [OpenAPI](../../packages/openapi/spec/recurring.responsible.ts)

## Rules

- Server tests must live only in
  [internal/apitest/](internal/apitest/AGENTS.md).
- never skip running `task check` after editing `./**/*.go`
- never run `task check` without escalating permissions (has docker calls
  inside)
