-- CreateProject creates a project and links it to a user.
-- name: CreateProject :one
WITH created_project AS (
    INSERT INTO projects (name)
    VALUES (pggen.arg('Name'))
    RETURNING id
)

INSERT INTO users_projects (user_id, project_id, role)
SELECT pggen.arg('UserID'), created_project.id, 'owner'
FROM created_project
RETURNING project_id;

-- FirstProjectID returns the first project linked to a user, lazily creating a default project when none exists.
-- name: FirstProjectID :one
WITH selected_user AS (
    SELECT id
    FROM users
    WHERE id = pggen.arg('UserID')
    FOR UPDATE
),

first_project AS (
    SELECT projects.id
    FROM projects
    INNER JOIN users_projects ON users_projects.project_id = projects.id
    INNER JOIN selected_user ON selected_user.id = users_projects.user_id
    ORDER BY projects.created_at, projects.id
    LIMIT 1
),

created_project AS (
    INSERT INTO projects (name)
    SELECT 'Home'
    FROM selected_user
    WHERE NOT EXISTS (SELECT 1 FROM first_project)
    RETURNING id
),

linked_project AS (
    INSERT INTO users_projects (user_id, project_id, role)
    SELECT selected_user.id, created_project.id, 'owner'
    FROM selected_user
    CROSS JOIN created_project
    RETURNING project_id
)

SELECT id
FROM first_project
UNION ALL
SELECT project_id
FROM linked_project
LIMIT 1;
