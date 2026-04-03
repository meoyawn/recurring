# Recurring

A simple **Web2** app for tracking and managing **recurring expenses**—subscriptions, bills, retainers, and anything that repeats on a schedule.

It is aimed at **individuals**, **small businesses**, **teams**, and **families** who want a straightforward place to see what repeats, when it hits, and how much it costs over time.

## Repository layout

- **`apps/web`** — SolidStart frontend (Bun)
- **`packages/openapi`** — OpenAPI spec and codegen (TypeScript client, optional Go server stubs)
- **`apps/api`** — API layer (stubs generated from the OpenAPI package where applicable)

## Prerequisites (local development)

Install the tools below via each project’s official installer or a package manager such as Homebrew (or your platform’s equivalent).

| Tool | Role in this repo | Ubuntu notes |
|------|-------------------|--------------|
| **Go** | `apps/api` and OpenAPI server stub generation | `golang-go` (universe) or a pinned toolchain from [go.dev/dl](https://go.dev/dl/) |
| **Bun** | JS/TS deps and `apps/web` / `packages/openapi` scripts | [bun.sh](https://bun.sh/) install script (not in default Ubuntu repos) |
| **Ansible** | `ops/ansible` playbooks (Postgres, API deploy, WAL-G, etc.) | `ansible` / `ansible-core` via APT or `pip` |
| **Terraform** | `ops/terraform` infrastructure | [HashiCorp APT repo](https://developer.hashicorp.com/terraform/install) or pinned binary |
| **Docker Engine + Compose** | Local integration stack: Postgres in [`compose/postgres/`](compose/postgres/) (and WAL-G-related flows where you mirror them in Compose) | Docker’s [APT instructions](https://docs.docker.com/engine/install/ubuntu/); use the **Compose V2 plugin** (`docker compose`, package `docker-compose-plugin`) |
| **Task** | Monorepo task runner | [taskfile.dev](https://taskfile.dev/installation/) — install the `task` binary |

Ensure the Docker daemon is running so `docker compose` can start Postgres (and any companion services you add for WAL-G).

## Quick start

With the prerequisites installed:

```bash
task install    # install dependencies
task dev:web    # run the web app locally
```

Other tasks: `task --list`.
