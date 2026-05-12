-- CreateProject creates a project owned by a user.
-- name: CreateProject :one
INSERT INTO projects (user_id, name)
VALUES (pggen.arg('UserID'), pggen.arg('Name'))
RETURNING id;
