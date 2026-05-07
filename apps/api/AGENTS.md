# API

- Main backend
- [Go Echo](https://github.com/labstack/echo)
- [OpenAPI](../../packages/openapi/spec/recurring.responsible.ts)

## Rules

- Server tests must live only in [internal/apitest](internal/apitest/AGENTS.md).
- Never write a test without `t.Parallel()`
