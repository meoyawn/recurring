---
name: pggen
description:
  Use when creating, editing, reviewing, renaming, or discussing any
  `*.pggen.sql` file.
---

# pggen

- Wrap nullable input values with `NULLIF(pggen.arg('Name'), '')` in SQL,
  because current pggen resolves query arguments as non-nullable Go types and
  ignores column nullability for arguments.
- never use `public` namespace
