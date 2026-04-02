# Local Postgres

Development-only database. Not used for production provisioning (see `ops/terraform` and `ops/ansible`).

```bash
docker compose up -d
```

Connection (defaults above):

- Host: `127.0.0.1`
- Port: `5432`
- User / password / database: `recurring` / `recurring` / `recurring`

Set `DATABASE_URL` (or your app’s equivalent) in `apps/api` `.env` when you wire repositories.
