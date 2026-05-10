# Frontend Production Environment

Status: revised

The current production target is Cloudflare Workers, so production runtime
config belongs in Worker bindings.

## Success Criteria

- Decide where production frontend Worker bindings are owned.
- Decide how sensitive Worker bindings are provided without committing secrets.
- Decide how local development keeps the same config shape without duplicating
  production values.
- Keep the same ownership model available for API secrets.

## Observations

- The Inertia Worker target uses Cloudflare Workers vars and secrets as
  bindings.
- Non-sensitive values should be vars.
- `GOOGLE_CLIENT_SECRET` should be a secret binding.
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

Production frontend config should be Cloudflare Worker bindings:

- `RECURRING_API_ORIGIN`: plain-text Worker binding.
- `GOOGLE_CLIENT_ID`: plain-text Worker binding.
- `GOOGLE_REDIRECT_URI`: plain-text Worker binding when the default
  `<request-origin>/auth/google/callback` is not enough.
- `GOOGLE_CLIENT_SECRET`: secret Worker binding.

If Terraform owns production Worker deployment, Terraform should own the Worker
version bindings too. Do not split production binding ownership between
Terraform and Wrangler for the same Worker, because deploys can replace the
binding set attached to the Worker version.

Only use the `secret_text` Terraform path after remote state encryption,
restricted state access, and secret injection from CI or local environment are
accepted. Until then, keep Terraform owning non-secret Worker resources and use
a dedicated deploy step such as Wrangler secrets or Cloudflare API calls for
`GOOGLE_CLIENT_SECRET`.

## API Secret Ownership

The API should keep its YAML config model. Production systemd should set:

```ini
Environment=RECURRING_CONFIG=/etc/recurring/api.yaml
```

Ansible can still render `/etc/recurring/api.yaml` from encrypted API-owned
inputs. This decision only supersedes frontend dotenv render paths.

## Unresolved

- Exact production frontend deploy owner: Terraform-only Worker versions, or
  Wrangler deploy with Terraform limited to DNS/routes.
- Exact handling for `GOOGLE_CLIENT_SECRET`: Terraform `secret_text` with
  protected remote state, or external secret-binding step.

## Sources

- Cloudflare Workers environment variables:
  https://developers.cloudflare.com/workers/configuration/environment-variables/
- Cloudflare Workers Terraform examples:
  https://developers.cloudflare.com/workers/platform/infrastructure-as-code/
- Terraform sensitive data guidance:
  https://developer.hashicorp.com/terraform/language/manage-sensitive-data

## Criteria Status

- Production frontend Worker binding ownership: answered, but deploy owner
  remains unresolved.
- Sensitive Worker binding input: answered at model level, unresolved at state
  policy level.
- Local development config: answered.
- Same ownership model for API secrets: answered; unchanged from the previous
  API YAML model.
