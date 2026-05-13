-- InsertExpense inserts an expense for a project owned by a user.
-- name: InsertExpense :one
WITH owned_project AS (
    SELECT id
    FROM projects
    WHERE id = pggen.arg('ProjectID') AND user_id = pggen.arg('UserID')
)

INSERT INTO expenses (
    project_id,
    name,
    amount_minor,
    currency,
    recurring,
    started_at,
    category,
    comment,
    cancel_url,
    canceled_at
)
SELECT
    owned_project.id,
    pggen.arg('Name'),
    pggen.arg('AmountMinor')::bigint,
    pggen.arg('Currency')::text,
    NULLIF(pggen.arg('Recurring'), '')::interval,
    TO_TIMESTAMP(pggen.arg('StartedAtUnixMillis')::bigint::double precision / 1000),
    NULLIF(pggen.arg('Category'), ''),
    NULLIF(pggen.arg('Comment'), ''),
    NULLIF(pggen.arg('CancelURL'), ''),
    TO_TIMESTAMP(NULLIF(pggen.arg('CanceledAtUnixMillis'), '')::double precision / 1000)
FROM owned_project
RETURNING id;
