# Taskfile Nesting

## Decision

Use nested Taskfiles before considering a heavier build system.

Keep the root `Taskfile.yml` as the user-facing command surface, but move
domain-specific commands into nearby Taskfiles:

- `packages/openapi/Taskfile.yml` for OpenAPI generation
- `apps/web/Taskfile.yml` for SolidStart install, dev, build, lint, and checks
- `apps/api/Taskfile.yml` for Go run, test, vet, and future migration helpers
- optional `ops/ansible/Taskfile.yml` and `ops/terraform/Taskfile.yml` when those
  workflows stop fitting cleanly in the root file

Include them from the root with namespaces and explicit `dir` values. That keeps
commands short, removes repeated `cd ... &&`, and preserves one top-level CLI:
`task web:dev`, `task api:test`, `task openapi:gen:client`.

## Why This Fits

This repo is already split into clear operating areas:

- `packages/openapi` owns the contract and generator config
- `apps/web` owns the Bun/SolidStart workflow
- `apps/api` owns the Go backend workflow
- `ops` owns deployment and infrastructure workflows

The current root `Taskfile.yml` is still small, but it is already doing manual
directory dispatch. Task's include mechanism gives the repo most of the
monorepo ergonomics needed right now without introducing Bazel-level setup cost.

## Task Include Behavior

Task supports nesting through the root-level `includes` map.

Simple include syntax:

```yaml
version: "3"

includes:
  web: ./apps/web
  api: ./apps/api
  openapi: ./packages/openapi
```

When the include value is a directory, Task looks for a supported Taskfile name
inside that directory. Included tasks are called through their namespace, such as
`task web:dev`.

Use object syntax when the included tasks should run from their own directory:

```yaml
version: "3"

includes:
  web:
    taskfile: ./apps/web
    dir: ./apps/web
  api:
    taskfile: ./apps/api
    dir: ./apps/api
  openapi:
    taskfile: ./packages/openapi
    dir: ./packages/openapi
```

This is the better default for this repo because the package-local commands
already assume their own working directories.

Important details from the Task docs:

- included tasks are namespaced by default
- relative include paths are resolved relative to the Taskfile doing the include
- included Taskfiles must use the same schema version as the root Taskfile
- `dir` controls the working directory for included tasks
- `optional: true` allows an included Taskfile to be missing
- `internal: true` hides all tasks from an included utility Taskfile
- `flatten: true` exposes included tasks without their namespace, but task name
  collisions become errors unless excluded
- `excludes` can remove selected tasks from an include
- `vars` can pass variables into included Taskfiles
- `aliases` can give a namespace shorter names, for example `openapi` aliased to
  `oa`
- from inside an included Taskfile, a root task is referenced with a leading
  colon, for example `task: :reindex`

## Recommended Shape

Root `Taskfile.yml`:

```yaml
version: "3"

includes:
  web:
    taskfile: ./apps/web
    dir: ./apps/web
  api:
    taskfile: ./apps/api
    dir: ./apps/api
  openapi:
    taskfile: ./packages/openapi
    dir: ./packages/openapi

tasks:
  reindex:
    cmd: uvx code-review-graph build
    sources:
      - "apps/**/*"
      - "ops/**/*"

  install:
    desc: Install project dependencies
    cmds:
      - task: openapi:install
      - task: web:install

  openapi:gen:
    desc: Generate all OpenAPI outputs
    cmds:
      - task: openapi:gen:client
      - task: openapi:gen:server-stubs
```

`packages/openapi/Taskfile.yml`:

```yaml
version: "3"

tasks:
  install:
    desc: Install OpenAPI generator dependencies
    cmd: bun install

  gen:client:
    desc: Generate TypeScript client into apps/web/gen
    cmd: bun run generate:client

  gen:server-stubs:
    desc: Generate Go server stubs into apps/api/gen
    cmd: bun run generate:server-stubs

  gen:
    desc: Generate all OpenAPI outputs
    cmds:
      - task: gen:client
      - task: gen:server-stubs
```

`apps/web/Taskfile.yml`:

```yaml
version: "3"

tasks:
  install:
    desc: Install web dependencies
    cmd: bun install

  dev:
    desc: Start SolidStart dev server
    cmd: bun run dev

  build:
    desc: Build SolidStart app
    cmd: bun run build
```

`apps/api/Taskfile.yml`:

```yaml
version: "3"

tasks:
  dev:
    desc: Run Go API locally
    cmd: go run ./cmd/api

  test:
    desc: Run Go tests
    cmd: go test ./...

  vet:
    desc: Run Go vet
    cmd: go vet ./...
```

## Naming Guidance

Prefer namespaces for package ownership:

- `web:*` for frontend workflows
- `api:*` for backend workflows
- `openapi:*` for contract and codegen workflows
- `ansible:*` and `terraform:*` only when ops workflows grow

Keep root tasks for cross-cutting workflows:

- `install`
- `dev`
- `check`
- `test`
- `build`
- `openapi:gen`
- `reindex`

Avoid `flatten: true` for application Taskfiles. Namespaces make ownership
clear, prevent collisions, and keep root `task --list-all` readable. Consider
`flatten: true` only for a tiny internal utility Taskfile whose task names are
intentionally root-level.

## Execution Guidance

Use `cmds` with `task:` calls when order matters. Task dependencies in `deps`
run in parallel, which is useful for independent checks but wrong for workflows
where one generated output must exist before a build.

Good serial orchestration:

```yaml
tasks:
  check:
    cmds:
      - task: openapi:gen
      - task: api:test
      - task: web:build
```

Good parallel grouping:

```yaml
tasks:
  test:
    deps:
      - api:test
      - web:build
```

Add `sources` and `generates` to expensive codegen tasks later if OpenAPI
generation becomes slow or noisy. Task can skip work by fingerprinting sources,
which is enough for this repo before adopting a full build graph.

## Migration Plan

1. Add package-local Taskfiles for `packages/openapi`, `apps/web`, and
   `apps/api`.
2. Replace root `cd ... && ...` commands with namespaced includes and `task:`
   calls.
3. Keep the current public command names where useful by making root aliases or
   wrappers.
4. Add `check`, `test`, and `build` root tasks once the package-local tasks
   exist.
5. Only add ops Taskfiles when there are enough Ansible or Terraform commands to
   justify the split.

## Bazel Boundary

Nested Taskfiles are not a replacement for Bazel if the repo later needs
hermetic builds, remote cache, cross-language dependency analysis, or release
artifact graphs. They are a better next step now because there is no planned
CI/CD yet and the current workflow mostly needs clean command organization.

## Sources

- Task guide, including Taskfile includes and execution behavior:
  https://taskfile.dev/docs/guide
- Task schema reference for include fields:
  https://taskfile.dev/docs/reference/schema
