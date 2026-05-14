-- InsertExpense inserts an expense for a project owned by a user.
-- name: InsertExpense :one
WITH owned_project AS (
    SELECT projects.id
    FROM projects
    INNER JOIN users_projects ON users_projects.project_id = projects.id
    WHERE projects.id = pggen.arg('ProjectID') AND users_projects.user_id = pggen.arg('UserID')
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

-- ListExpenses lists expenses for a project owned by a user.
-- name: ListExpenses :many
WITH listed_expenses AS (
    SELECT
        COALESCE(expenses.id, '') AS id,
        COALESCE(expenses.name, '') AS name,
        expenses.amount_minor,
        COALESCE(expenses.currency::text, '') AS currency,
        expenses.recurring,
        EXTRACT(YEAR FROM expenses.recurring)::bigint AS recurring_years,
        EXTRACT(MONTH FROM expenses.recurring)::bigint AS recurring_months,
        EXTRACT(DAY FROM expenses.recurring)::bigint AS recurring_days,
        EXTRACT(HOUR FROM expenses.recurring)::bigint AS recurring_hours,
        EXTRACT(MINUTE FROM expenses.recurring)::bigint AS recurring_minutes,
        EXTRACT(SECOND FROM expenses.recurring) AS recurring_seconds,
        (EXTRACT(EPOCH FROM expenses.started_at) * 1000)::bigint AS started_at_unix_millis,
        expenses.category,
        expenses.comment,
        expenses.cancel_url,
        CASE
            WHEN expenses.canceled_at IS NULL THEN NULL
            ELSE ((EXTRACT(EPOCH FROM expenses.canceled_at) * 1000)::bigint)::text
        END AS canceled_at_unix_millis,
        expenses.created_at
    FROM expenses
    INNER JOIN users_projects ON users_projects.project_id = expenses.project_id
    WHERE expenses.project_id = pggen.arg('ProjectID')
      AND users_projects.user_id = pggen.arg('UserID')
)

SELECT
    id,
    name,
    amount_minor,
    currency,
    CASE
        WHEN recurring IS NULL THEN NULL
        ELSE CONCAT(
            'P',
            CASE WHEN recurring_years = 0 THEN '' ELSE recurring_years::text || 'Y' END,
            CASE WHEN recurring_months = 0 THEN '' ELSE recurring_months::text || 'M' END,
            CASE WHEN recurring_days = 0 THEN '' ELSE recurring_days::text || 'D' END,
            CASE
                WHEN recurring_hours = 0 AND recurring_minutes = 0 AND recurring_seconds = 0 THEN ''
                ELSE CONCAT(
                    'T',
                    CASE WHEN recurring_hours = 0 THEN '' ELSE recurring_hours::text || 'H' END,
                    CASE WHEN recurring_minutes = 0 THEN '' ELSE recurring_minutes::text || 'M' END,
                    CASE
                        WHEN recurring_seconds = 0 THEN ''
                        ELSE TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM recurring_seconds::text)) || 'S'
                    END
                )
            END
        )
    END AS recurring,
    started_at_unix_millis,
    category,
    comment,
    cancel_url,
    canceled_at_unix_millis
FROM listed_expenses
ORDER BY created_at, id;
