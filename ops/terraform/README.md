# Terraform

Infrastructure for this monorepo lives under **`ops/terraform/`** (not at the repository root). App code is in **`apps/`**; Terraform only touches cloud resources (servers, DNS, firewalls, etc.).

## Layout

- **`modules/`** — reusable modules (network, compute, DNS, etc.).
- **`envs/prod/`** — production root module: wires modules, pins versions, configures backend.

From the repo root:

```bash
cd ops/terraform/envs/prod
terraform init
terraform plan
terraform apply
```

## Providers and secrets (Hetzner + Cloudflare)

This stack expects **Hetzner Cloud** (compute, volumes, firewalls, etc.) and **Cloudflare** (DNS, and any other resources you add via their provider). **API credentials must never be committed** — not in `.tf` files, not in `terraform.tfvars`, not in `*.auto.tfvars`.

### How authentication works

Both official Terraform providers read credentials from **environment variables**. That keeps secrets out of git and matches how automation (e.g. a pipeline secret store mapped to `env`) injects them.

| Provider    | Purpose (typical)     | Set these in your shell or CI (examples) |
| ----------- | --------------------- | ----------------------------------------- |
| **Hetzner** | Cloud API             | `HCLOUD_TOKEN` — [Cloud Console](https://console.hetzner.cloud/) → project → Security → API tokens (read/write as needed). |
| **Cloudflare** | DNS / zone resources | `CLOUDFLARE_API_TOKEN` — [Cloudflare dashboard](https://dash.cloudflare.com/profile/api-tokens) → Create Token, with least privilege for DNS (and other scopes your modules need). |

Optional legacy Cloudflare auth (global API key) exists as `CLOUDFLARE_EMAIL` + `CLOUDFLARE_API_KEY`; prefer **API tokens** (`CLOUDFLARE_API_TOKEN`) for narrower scope and rotation.

Provider blocks in Terraform should **not** hard-code `token` / `api_token` values for production; rely on env vars so the same code works locally and in CI.

### Non-secret configuration

Values that are **not** secret (region, server type, zone names as identifiers, feature flags) can live in:

- committed **[`envs/prod/terraform.tfvars.example`](envs/prod/terraform.tfvars.example)** (comments and placeholder names only), and
- a **gitignored** `terraform.tfvars` or `*.auto.tfvars` per developer, **or**
- **`TF_VAR_<name>`** environment variables for CI.

Do **not** put Hetzner or Cloudflare API keys into tfvars; keep them only in env (or a secret manager that exports env before `terraform` runs).

### Local workflow

1. Export tokens (e.g. in `~/.zshrc` or a local file you `source` — that file should stay **outside** the repo or be gitignored):

   ```bash
   export HCLOUD_TOKEN="..."
   export CLOUDFLARE_API_TOKEN="..."
   ```

2. Run Terraform from `ops/terraform/envs/prod` as above.

3. Confirm `git status` does not show new `.tfvars` or override files containing secrets.

### CI workflow

1. Store `HCLOUD_TOKEN` and `CLOUDFLARE_API_TOKEN` (and any backend creds, e.g. for remote state) in your platform’s **secret store**.
2. Map them to **`env`** on the Terraform job so the providers pick them up automatically.
3. Use **`TF_VAR_*`** for any other sensitive *Terraform variables* you define, or generate a short-lived tfvars file from secrets in the job (never commit it).

### Remote state

If you use a remote backend (S3, Terraform Cloud, Hetzner Object Storage, etc.), backend credentials are **also** secrets: supply them via env or OIDC, not committed config.

### Open source checklist

- No API keys or tokens in tracked `.tf` / `.tfvars` / `.auto.tfvars`.
- Root [`.gitignore`](../../.gitignore) ignores Terraform state, `.terraform/`, `*.tfvars`, and `*.auto.tfvars` (the committed `terraform.tfvars.example` is not ignored because it ends with `.example`, not `.tfvars`).
- Required provider env vars are documented above; [`envs/prod/terraform.tfvars.example`](envs/prod/terraform.tfvars.example) lists names and patterns only.
