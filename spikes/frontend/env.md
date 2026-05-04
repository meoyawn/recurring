# Frontend Production Environment

Status: revised

The earlier dotenv-and-Ansible plan was for a Node-style production process. The
current production target is Cloudflare Workers, so production runtime config
belongs in Worker bindings, not in `apps/web/.env.production`.

## Success Criteria

- Decide whether production renders `apps/web/.env.production`.
- Decide where production web Worker bindings are owned.
- Decide how sensitive Worker bindings are provided without committing secrets.
- Decide how local development keeps the same config shape without duplicating
  production values.
- Keep the same ownership model available for API secrets.

## Observations

- `apps/web/.env.development` documents the local dotenv shape:
  `RECURRING_API_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  optional `GOOGLE_REDIRECT_URI`.
- `apps/web/src/lib/googleAuth.ts` currently reads `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `RECURRING_API_ORIGIN`, and
  `NODE_ENV` from `globalThis.process.env`.
- `apps/web/src/lib/api.ts` currently reads `RECURRING_API_ORIGIN` from
  Cloudflare Worker bindings, then falls back to `http://localhost:8080`.
- `spikes/frontend/inertia.md` already records the Worker target constraint:
  Cloudflare Workers expose vars and secrets as bindings; non-sensitive values
  should be vars and `GOOGLE_CLIENT_SECRET` should be a secret binding.
- Cloudflare Workers Terraform examples model Worker runtime config on the
  Worker version `bindings` array. They use `plain_text` for environment
  variables and `secret_text` for secret environment variables.
- Cloudflare Wrangler docs also support local `.env` / `.dev.vars` files for
  development. They are local-development inputs, not the production source of
  truth when Terraform owns the Worker.
- Terraform state can contain managed resource arguments. If Terraform receives
  `GOOGLE_CLIENT_SECRET` as `secret_text`, the Terraform state backend and state
  access policy become part of the secret boundary.
- `ops/terraform/envs/prod/main.tf` is still a placeholder and does not yet own
  Cloudflare Worker resources, routes, DNS, or Worker bindings.
- `ops/terraform/README.md` already says Cloudflare API credentials must come
  from environment variables, and real `terraform.tfvars` / `*.auto.tfvars`
  files must stay uncommitted.
- `apps/api/internal/config/config.go` does not use dotenv. It requires
  `RECURRING_CONFIG` and loads YAML from that path.

## Decision

Production web should not render or deploy `apps/web/.env.production`.

Production web config should be Cloudflare Worker bindings:

- `RECURRING_API_ORIGIN`: plain-text Worker binding.
- `GOOGLE_CLIENT_ID`: plain-text Worker binding.
- `GOOGLE_REDIRECT_URI`: plain-text Worker binding when the default
  `<request-origin>/auth/google/callback` is not enough.
- `GOOGLE_CLIENT_SECRET`: secret Worker binding.

If Terraform owns production Worker deployment, Terraform should own the Worker
version bindings too. Do not split production binding ownership between
Terraform and Wrangler for the same Worker, because deploys can replace the
binding set attached to the Worker version.

Terraform shape:

```hcl
bindings = [
  {
    name = "RECURRING_API_ORIGIN"
    type = "plain_text"
    text = var.recurring_api_origin
  },
  {
    name = "GOOGLE_CLIENT_ID"
    type = "plain_text"
    text = var.google_client_id
  },
  {
    name = "GOOGLE_REDIRECT_URI"
    type = "plain_text"
    text = var.google_redirect_uri
  },
  {
    name = "GOOGLE_CLIENT_SECRET"
    type = "secret_text"
    text = var.google_client_secret
  },
]
```

Only use the `secret_text` Terraform path after remote state encryption,
restricted state access, and secret injection from CI or local environment are
accepted. Until then, keep Terraform owning non-secret Worker resources and use
a dedicated deploy step such as Wrangler secrets or Cloudflare API calls for
`GOOGLE_CLIENT_SECRET`.

## Local Development

Local development can keep using dotenv:

```dotenv
RECURRING_API_ORIGIN=http://localhost:8080
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

Do not duplicate production values into local dotenv files. Local dotenv values
exist to run `vite dev` / local Worker emulation only.

`wrangler.toml` may keep empty or placeholder `[vars]` declarations when needed
for local types and binding shape. It should not carry production values if
Terraform owns production.

## API Secret Ownership

The API should keep its YAML config model. Production systemd should set:

```ini
Environment=RECURRING_CONFIG=/etc/recurring/api.yaml
```

Ansible can still render `/etc/recurring/api.yaml` from encrypted API-owned
inputs. This decision only supersedes the web `.env.production` render path.

## Git Ignore

Rendered production web dotenv is no longer expected. If a local inspection task
ever renders it again, it must stay ignored:

```gitignore
apps/web/.env.production
apps/api/config/production.yaml
```

Do not ignore encrypted source artifacts if they are later introduced under
app-owned `ansible/` directories.

## Unresolved

- Exact production web deploy owner: Terraform-only Worker versions, or Wrangler
  deploy with Terraform limited to DNS/routes.
- Exact handling for `GOOGLE_CLIENT_SECRET`: Terraform `secret_text` with
  protected remote state, or external secret-binding step.
- Code still needs one consistent Worker binding read path for Google auth;
  `googleAuth.ts` currently reads `process.env`.

## Sources

- Cloudflare Workers environment variables:
  https://developers.cloudflare.com/workers/configuration/environment-variables/
- Cloudflare Workers Terraform examples:
  https://developers.cloudflare.com/workers/platform/infrastructure-as-code/
- Terraform sensitive data guidance:
  https://developer.hashicorp.com/terraform/language/manage-sensitive-data

## Criteria Status

- Production `.env.production` rendering: disproven for Worker production.
- Production web Worker binding ownership: answered, but deploy owner remains
  unresolved.
- Sensitive Worker binding input: answered at model level, unresolved at state
  policy level.
- Local development config: answered.
- Same ownership model for API secrets: answered; unchanged from the previous
  API YAML model.
