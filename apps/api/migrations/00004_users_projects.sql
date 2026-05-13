-- +goose Up
CREATE TABLE users_projects (
    user_id    text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    project_id text        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    role       text        NOT NULL CHECK (length(role) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, project_id)
);

INSERT INTO users_projects (user_id, project_id, role)
SELECT user_id, id, 'owner'
FROM projects;

ALTER TABLE projects DROP COLUMN user_id;
