# API Dynamic Config Decision

Decision: use a single dynamic YAML config file selected by `RECURRING_CONFIG`.

This spike covers runtime config that changes between local development and
production. Static config is deliberately out of scope and remains tracked by
`t_11`.

## Success Criteria

From `kanban/TODO.yaml`:

```text
apps/api can talk to local compose postgres without hardcoding host, port,
username, password, etc.
```

Status: answered. The API should load Postgres host, port, database, user,
password, ssl mode, and pool size from committed dev YAML, derive the Postgres
URL in memory, run goose migrations, then open pgxpool. No database endpoint or
credential should be hardcoded in Go.

Implementation success criteria:

- `task api:dev` sets `RECURRING_CONFIG=config/dev.yaml`.
- API loads DB host, port, name, user, password, ssl mode, and max connection
  count from `apps/api/config/dev.yaml`.
- Go code contains no hardcoded Postgres endpoint or credential values.
- Startup derives the Postgres URL in memory, opens a short-lived migration
  connection, runs goose migrations, closes that connection, then opens
  `pgxpool`.
- The first migration defines the `expenses` table and is wired into startup;
  applying it to local Compose Postgres is verified by launching `task api:dev`.
- The full Postgres URL and password are never logged or passed as command-line
  flags.

## Sources

Local evidence:

- `compose/docker-compose.yml` defines local Postgres on host port `5432` with
  database, user, and password all set to `recurring`.
- `apps/api/cmd/api/main.go` currently reads only `RECURRING_API_ADDR`, so it
  needs a real config system before Postgres wiring.
- `spikes/backend/postgres.md` already decides on `pgx`, `pgxpool`, and `goose`,
  and startup migrations before serving requests.
- `spikes/backend/linux.md` already decides on systemd socket activation in
  production and app-owned local listeners in development.
- `spikes/backend/migration.md` owns the first migration schema design.

External evidence:

- `koanf` is a Go config library for reading multiple sources and formats,
  including files and YAML parsers: https://pkg.go.dev/github.com/knadh/koanf/v2
- Task supports per-task `env`, which is enough to set `RECURRING_CONFIG` for
  `task api:dev`: https://taskfile.dev/usage/
- Ansible Vault can encrypt entire structured files and `ansible-vault edit`
  decrypts to a temporary editor buffer then re-encrypts after save:
  https://docs.ansible.com/ansible/latest/vault_guide/vault_encrypting_content.html
- Ansible intentionally copies Vault-encrypted source files as decrypted files
  on the target when used with copy/template-style modules:
  https://docs.ansible.com/projects/ansible/6/user_guide/vault.html
- `goose.UpContext` applies available migrations with a context:
  https://pkg.go.dev/github.com/pressly/goose/v3#UpContext
- `pgxpool.ParseConfig` supports connection strings and `MaxConns`; pgxpool's
  default max is the greater of `4` or `runtime.NumCPU()`, so this project
  should set `max_conns` explicitly for a small VPS:
  https://pkg.go.dev/github.com/jackc/pgx/v5/pgxpool
- `go-systemd` activation exposes inherited systemd listeners through
  `activation.Listeners()`:
  https://pkg.go.dev/github.com/coreos/go-systemd/v22/activation#Listeners

## Decision

Use this dynamic config pipeline:

```text
defaults in Go
-> YAML file from RECURRING_CONFIG
-> typed validation
-> derived runtime values such as Postgres URL
```

Do not add per-key environment overrides now. The only environment variable for
this config path is:

```text
RECURRING_CONFIG
```

Reason: a single runtime config file keeps dev and production mental models the
same. Per-key env overrides would add hidden state and make it harder to know
what the API is actually running with.

Use `koanf` for loading the YAML file into a typed config struct. It is light
enough for the first version and leaves room for static config layering later
without forcing that design now.

## Config Locations

Development config:

```text
apps/api/config/dev.yaml
```

This file must be committed and safe for an open source clone. It should point
at local Compose services.

Production source config:

```text
ops/ansible/roles/api/files/api.prod.yaml
```

This file should be committed as whole-file Ansible Vault ciphertext. Humans
edit it with:

```fish
env EDITOR="zed --wait" ansible-vault edit ops/ansible/roles/api/files/api.prod.yaml
```

Production runtime config on the VPS:

```text
/etc/recurring/api.yaml
```

The Ansible API role should copy and decrypt the vaulted source file to that
path with owner/group/mode similar to:

```text
root:recurring 0640
```

The systemd service should set:

```ini
Environment=RECURRING_CONFIG=/etc/recurring/api.yaml
```

No templates are part of this decision.

## Config Schema

Do not include `env` or `environment` fields. Behavior should come from explicit
config fields, not branching on an environment name.

Recommended dev config:

```yaml
api:
  listener:
    kind: unix
    path: /tmp/recurring-api.sock

db:
  host: 127.0.0.1
  port: 5432
  name: recurring
  user: recurring
  password: recurring
  sslmode: disable
  max_conns: 4
```

Recommended prod config shape:

```yaml
api:
  listener:
    kind: systemd

db:
  host: 127.0.0.1
  port: 5432
  name: recurring
  user: recurring
  password: "<vaulted plaintext after deploy>"
  sslmode: disable
  max_conns: 4
```

Supported listener kinds:

- `tcp`: app owns a TCP listener at `api.listener.addr`
- `unix`: app owns a Unix socket at `api.listener.path`
- `systemd`: app receives exactly one inherited systemd listener

For app-owned Unix sockets, remove a stale socket path before binding. Never
remove a systemd-owned socket.

## Go Package Shape

Use:

```text
apps/api/internal/config/
```

Responsibilities:

- read `RECURRING_CONFIG`
- load YAML through `koanf`
- apply Go defaults
- unmarshal into typed structs
- validate required fields and listener-specific fields
- build the Postgres URL in memory from structured DB fields
- never log the full Postgres URL because it contains the password

Do not put config loading into `cmd/api`. The previous Listenbox backend config
was already about 250 lines; this project will grow into observability, DB,
listener, sheets, auth, and export settings. Keeping config isolated avoids a
large `main.go`.

## Startup Shape

Use the Postgres startup plan, adjusted for structured config:

```text
load config from RECURRING_CONFIG
derive Postgres URL in memory
open short-lived database/sql connection through pgx stdlib
run goose up
close migration connection
open pgxpool with MaxConns from config
build routes
open configured listener
start HTTP server
```

Do not add explicit DB pings. `goose up` already proves the migration connection
can talk to Postgres, and opening the pool is part of normal startup.

If migrations fail, startup fails. The process exits non-zero. In systemd
production, the service does not announce readiness.

## Migration Schema

Migration schema design lives in [migration.md](migration.md). This config
decision only requires the API to run goose migrations from
`apps/api/migrations` before opening `pgxpool`.

Do not leave migrations empty. The first migration should prove startup
migration plumbing by creating the core expense storage selected in
[migration.md](migration.md).

## Task Wiring

`apps/api/Taskfile.yaml` should set the config path for dev:

```yaml
tasks:
  dev:
    env:
      RECURRING_CONFIG: config/dev.yaml
    cmds:
      - go run ./cmd/api
```

Root tasks should own local service dependencies. Because `apps/sheets` will
also need observability services, keep dependency orchestration at the root:

```yaml
tasks:
  dev:deps:
    dir: compose
    cmds:
      - task dev

  api:dev:
    deps:
      - dev:deps
    cmds:
      - task api:dev

  sheets:dev:
    deps:
      - dev:deps
    cmds:
      - task sheets:dev
```

`compose/Taskfile.yaml` can later expand `dev` from only Postgres to Postgres
plus the local observability backend.

## Security

Open source repo rules:

- commit `apps/api/config/dev.yaml`
- do not commit plaintext production config
- commit `ops/ansible/roles/api/files/api.prod.yaml` only as Ansible Vault
  ciphertext
- do not put real prod IPs or secrets in units, task commands, logs, examples,
  or generated docs
- do not pass DB password through command-line flags

The simple first version stores prod secrets in the rendered VPS YAML file. That
file must be readable only by root and the service group. `LoadCredential=` is
not part of this spike; it can be reconsidered later if process/environment
secret isolation becomes worth the extra systemd machinery.

## Superseded Notes

`spikes/backend/postgres.md` and `spikes/backend/linux.md` mention
`DATABASE_URL`, `RECURRING_API_ADDR`, and `RECURRING_API_LISTEN`. This spike
supersedes those specific config names for the API process.

The runtime still derives a Postgres connection URL internally because `pgx`,
`pgxpool`, and goose accept that shape. The URL is no longer the public config
interface.

## Unresolved

Static config is unresolved by design and belongs to `t_11`.

Examples:

- product constants
- API route metadata not generated from OpenAPI
- provider-independent defaults that should never vary by dev/prod
- validation policy for committed static YAML versus Go constants

## Criterion Status

`apps/api can talk to local compose postgres without hardcoding host, port, username, password, etc.`:
answered.

Implementation should satisfy it by committing `apps/api/config/dev.yaml`, using
`RECURRING_CONFIG=config/dev.yaml` in `task api:dev`, deriving the Postgres URL
from structured YAML, running goose migrations against Compose Postgres, and
opening pgxpool with the configured pool limit.
