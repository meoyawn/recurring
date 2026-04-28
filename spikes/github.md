# GitHub Dependency Search Method

Status: exploratory

Date: 2026-04-29

Question: find GitHub repositories with exact dependency `@solidjs/start` at
version `2.0.0-alpha.2`, then rank by stars and/or issue/PR activity.

## Method

- Used GitHub code search for exact string matches:
  - query: `"@solidjs/start" "2.0.0-alpha.2" filename:package.json`
  - API endpoint: `GET /search/code`
  - result count observed: 77 matching `package.json` files.
- Fetched each matching `package.json` from `raw.githubusercontent.com`.
- Parsed JSON, then kept only files where `@solidjs/start` exactly equaled
  `2.0.0-alpha.2` in one of:
  - `dependencies`
  - `devDependencies`
  - `peerDependencies`
  - `optionalDependencies`
- Grouped matches by repository so template repos with many matching
  `package.json` files counted once.
- Fetched repository metadata via `GET /repos/{owner}/{repo}`:
  - stars
  - forks
  - open issue count
  - last push time
  - update time
  - archived flag
  - default branch
  - description
- For the top repositories by stars, fetched recent activity via issue search:
  - issues: `repo:{owner}/{repo} updated:>=2026-01-29 is:issue`
  - PRs: `repo:{owner}/{repo} updated:>=2026-01-29 is:pr`
  - activity score: recent issues plus recent PRs
- Sorted final top list by:
  - stars descending
  - last push time descending as tie-breaker
- Excluded weaker matches from final ranking:
  - lockfile-only hits
  - docs/backlog mentions
  - self-version hit in `solidjs/solid-start`

## Caveats

- GitHub code search is index-based, so brand-new pushes may lag.
- Search saw only public/indexed repositories visible to authenticated GitHub
  search.
- Activity metric used updated issues/PRs since 2026-01-29, not merged PRs or
  commit counts.
- `open_issues_count` from repository metadata includes issues and PRs.
