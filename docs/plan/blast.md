# Blast Radius Tooling

## Decision

Use `tirth8205/code-review-graph` as the primary review and blast-radius
workflow for this monorepo, after keeping its graph freshly indexed.

Do not add MCPs just to reach language servers. For Go, use `gopls`, `go list`,
`go test`, and `go vet` directly. For TypeScript, use the TypeScript toolchain
directly. Treat those tools as semantic authority and validation, not as the
primary blast-radius UX.

Reason:

- `code-review-graph` already has the product shape we need for review impact:
  changed-file fallout, impact radius, affected flows, hubs, bridges, test gaps,
  and suggested reading context
- prior research already found that Go tooling is better for fresh symbol facts,
  while `code-review-graph` is better for repo-level structural impact
- this repo's application center is graph-shaped: SolidStart frontend,
  OpenAPI contract/codegen, Go API, generated clients/stubs, and migrations
- the unsupported surfaces are important, but they are boundaries to call out,
  not a reason to demote the graph to an optional experiment

If forced to pick one category for review impact, pick `code-review-graph`.
If forced to pick one category for semantic correctness, pick native language and
platform tooling.

## Context From Previous Research

Prior blast-radius research in
`/Users/adelnizamutdinov/Projects/responsibleapi/docs/blast.md` concluded:

- `code-review-graph` is stronger at repo-level blast-radius summaries
- Go-native tooling, especially `gopls`, is stronger at always-fresh semantic
  facts
- `code-review-graph` needs graph build/update discipline
- Go tooling does not need a separate graph reindex step
- best Go-only answer is hybrid: `gopls` for semantic navigation, `go list` for
  package facts, `go test` and `go vet` for fallout, and `code-review-graph`
  for structural review context

The follow-up research in
`/Users/adelnizamutdinov/Projects/responsibleapi/docs/blast2.md` compared
`Sourcegraph` MCP with `code-review-graph` MCP and found:

- `code-review-graph` exposes first-class impact tools like impact radius,
  affected flows, hubs, bridges, knowledge gaps, and risk-scored change review
- more general code-intelligence systems can synthesize blast radius from lower
  level primitives, but that is agent-composed analysis rather than a dedicated
  impact API
- local-first repo state is a real advantage for `code-review-graph`

Those conclusions still apply here. The update is that `gopls` does not need an
MCP wrapper to be useful, and the choice is not "LSP MCPs versus graph MCP." The
choice is native semantic tools versus a graph-shaped review workflow.

## Repository Shape

This monorepo has four important surfaces:

- `apps/web`: SolidStart frontend
- `packages/openapi`: OpenAPI source of truth and code generation
- `apps/api`: Go API, generated stubs, real handlers, and SQL migrations
- `ops`: Terraform, Ansible, Caddy, inventories, roles, and deployment config

The application layer is a good fit for graph-based review:

- frontend code calls generated API clients
- OpenAPI changes generate TypeScript clients and optional Go stubs
- Go handlers, services, repositories, and migrations evolve together
- generated files can create useful edges, but can also add noise if indexed
  without discipline

The infrastructure and database layer is not fully captured by Go or TypeScript
parsers:

- SQL migrations can change schema contracts that application code assumes
- Terraform changes can alter hosts, networks, DNS, firewalls, and volumes
- Ansible changes can alter deployed services, env vars, systemd units,
  containers, packages, ports, and backup behavior
- Caddy and inventory changes can alter runtime routing and host shape

That means the graph can be primary for review orientation, but it must have an
explicit authority boundary.

## Tool Roles

Use `code-review-graph` for:

- changed-file review context
- impact radius
- affected flows
- hubs and bridge nodes
- surprising couplings
- suggested files and functions to read
- test-gap and review-risk prompts

Use native Go tooling for:

- `gopls`: definitions, references, call hierarchy, implementation lookup,
  rename safety, diagnostics, and semantic navigation
- `go list`: package/module facts and dependency boundaries
- `go test`: dynamic fallout
- `go vet`: static fallout

Use native TypeScript/frontend tooling for:

- TypeScript diagnostics
- generated client type checking
- frontend build and lint checks
- SolidStart/Vite configuration validation

Use explicit repo checks for:

- OpenAPI spec changes and generated client/stub drift
- SQL migrations, schema compatibility, and query coupling
- Terraform validation, formatting, and plans
- Ansible syntax, linting, inventories, roles, and vault-aware deploy behavior
- Caddy routing and runtime env/config references

Use `rg` for strings, YAML keys, SQL identifiers, env vars, route names,
generated-code references, and other non-typechecked surfaces.

## Practical Workflow

For everyday coding:

- use `gopls` and TypeScript tooling directly for symbol-level facts
- use direct toolchain checks for correctness
- use `rg` for strings and runtime/config surfaces
- use `code-review-graph` when the question becomes "what else should I read?"

For review and impact analysis:

- start from `git diff`
- ask `code-review-graph` for review context and impact radius
- verify Go symbol claims with `gopls`, `go list`, `go test`, and `go vet`
- verify TypeScript/client fallout with frontend type/build checks
- inspect OpenAPI changes and generated artifacts explicitly
- inspect SQL migrations, Terraform, Ansible, Caddy, inventories, and env vars
  explicitly when touched or referenced by the change
- use the graph's output as a reading map, not as proof that unsupported
  surfaces are safe

## Graph Discipline

`code-review-graph` should stay adopted only if the local workflow keeps it
fresh and useful:

- reindex or update before review work
- exclude dependency directories and build output
- decide intentionally whether generated clients/stubs are indexed, because
  they may be useful for API coupling but noisy for review
- compare graph suggestions against native tool fallout on real changes
- treat missing SQL, Terraform, Ansible, and runtime edges as known gaps

If graph upkeep becomes unreliable, keep native tools as the source of truth and
fall back to smaller repo-specific scripts for the cross-domain maps.

## Evaluation Gate

Keep `code-review-graph` as the primary review surface only if it passes these
checks on real changes in this repo:

- it does not miss obvious Go and TypeScript reference fallout
- it gives useful context for multi-file changes without excessive noise
- it saves review time compared with `gopls` plus `rg` plus native checks alone
- its update path stays reliable in local agent workflows
- it does not imply confidence over unsupported SQL, Terraform, Ansible, Caddy,
  or runtime configuration blast radius

If those checks fail, demote it to a secondary review aid and build small
repo-specific scripts for the missing cross-domain impact maps.

## Sources

- `code-review-graph` README: https://github.com/tirth8205/code-review-graph
- prior Go/tooling comparison:
  `/Users/adelnizamutdinov/Projects/responsibleapi/docs/blast.md`
- prior MCP comparison:
  `/Users/adelnizamutdinov/Projects/responsibleapi/docs/blast2.md`
