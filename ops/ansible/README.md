# Ansible

Playbooks under `playbooks/`; roles under `roles/`; inventory under `inventories/`.

Examples:

```bash
cd ops/ansible
ansible-playbook playbooks/bootstrap.yml
ansible-playbook playbooks/postgres.yml
ansible-playbook playbooks/deploy_api.yml
ansible-playbook playbooks/backups_walg.yml
```

Define host groups `db` and `api` in `inventories/prod/hosts.ini` (or use dynamic inventory). A sample `Caddyfile` lives in `caddy/` for `api.domain.com` → local Go listener.
