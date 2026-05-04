# Frontend Environment

Some local config is duplicated by design:

- [SolidStart uses Vite env loading][solid-env], so app dev reads
  `.env.development`.
- [Cloudflare Workers expose environment variables as bindings][cf-env], so the
  Worker runtime shape is declared in `wrangler.toml`.
- When the same non-secret value exists in both files, keep it identical.
  Otherwise local app code and Worker-emulated runtime can see different config
  for the same name.

Do not copy production secrets into local env files or committed Wrangler vars.

[solid-env]: https://docs.solidjs.com/configuration/environment-variables
[cf-env]:
  https://developers.cloudflare.com/workers/configuration/environment-variables/
