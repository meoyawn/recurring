# Ansible

Playbooks under `playbooks/`; roles under `roles/`; inventory under `inventories/`.

## Secrets (open source / public repo)

- **Commit** an **Ansible Vault**–encrypted vars file (convention: `group_vars/all/vault.yml` or `group_vars/<env>/vault.yml`). In git it looks like ciphertext; that is expected.
- **Never commit** the vault **passphrase**. Keep it on your machine (e.g. a file **outside** this repo) or in CI as a protected secret.
- **Never commit** plain `secrets.yml` with real passwords; use Vault for those values instead.

Create or edit encrypted vars:

```bash
cd ops/ansible
ansible-vault create group_vars/all/vault.yml    # first time
ansible-vault edit group_vars/all/vault.yml      # later
```

Run playbooks with the vault password (pick one):

```bash
# Password in a file outside the repo (recommended locally)
ansible-playbook playbooks/bootstrap.yml --vault-password-file ~/.config/recurring/ansible_vault_pass

# Same via env (path to that file)
export ANSIBLE_VAULT_PASSWORD_FILE=~/.config/recurring/ansible_vault_pass
ansible-playbook playbooks/bootstrap.yml
```

Optional: set `vault_password_file` in `ansible.cfg` to that path — **do not** point it at a file inside the repo.

**CI:** Add the vault passphrase as a repository secret. At the start of the job, write it to a temporary file (mode `600`), run `ansible-playbook ... --vault-password-file /tmp/vault_pass`, then delete the file. Same idea as local; the passphrase never lives in git.

## Examples

```bash
cd ops/ansible
ansible-playbook playbooks/bootstrap.yml
ansible-playbook playbooks/postgres.yml
ansible-playbook playbooks/deploy_api.yml
ansible-playbook playbooks/backups_walg.yml
```

Define host groups `db` and `api` in `inventories/prod/hosts.ini` (or use dynamic inventory). A sample `Caddyfile` lives in `caddy/` for `api.domain.com` → local Go listener.

## Ignored local files

The repo [`.gitignore`](../../.gitignore) ignores Ansible vault password filenames such as `.vault_pass` / `vault_pass.txt` under `ops/`, `*.retry`, and `ops/ansible/.ansible/` (controller temp from `local_tmp` in [`ansible.cfg`](ansible.cfg)).
