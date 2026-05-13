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
- Keep generated input params as primitive Go types. Avoid casts that make pggen
  emit pgx wrapper types such as `pgtype.BPChar`, `pgtype.Varchar`, or
  `pgtype.Float8`; prefer casting query args to primitive-friendly types such as
  `text` or `bigint` before the database target column applies stricter checks.
- never use `public` namespace
