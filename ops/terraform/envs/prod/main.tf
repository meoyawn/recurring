terraform {
  required_version = ">= 1.6.0"
  # required_providers { ... } — add when you pick a cloud provider
  # backend "s3" {}  # configure remote state for your team
}

# Example placeholder: replace with real provider resources (e.g. compute + DNS for api.domain.com).
output "placeholder" {
  value = "Define VMs, DNS, and networking in modules/ and wire them here."
}
