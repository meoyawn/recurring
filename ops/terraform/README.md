# Terraform

Layout:

- `modules/` — reusable modules (VPC, compute, DNS, etc.).
- `envs/prod/` — root module for production; pins module versions and backend state.

Initialize per environment:

```bash
cd envs/prod
terraform init
terraform plan
```

Replace example resources with your provider (Hetzner, AWS, GCP, etc.) before use.
