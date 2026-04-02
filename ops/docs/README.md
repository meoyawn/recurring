# Ops notes

High-level boundaries:

- **Terraform** (`ops/terraform/`) — cloud resources: VMs, firewall, DNS for `api.domain.com`, object storage, secrets managers, etc.
- **Ansible** (`ops/ansible/`) — OS and application configuration: Postgres, Caddy reverse proxy, Go API binary + systemd, WAL-G backups.

Application SQL migrations remain in `apps/api/migrations/`; automation here should apply or reference that directory as the source of truth.
