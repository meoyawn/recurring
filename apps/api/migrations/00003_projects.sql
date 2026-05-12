-- +goose Up
CREATE TABLE projects (
    id          text        NOT NULL PRIMARY KEY DEFAULT ('prj_' || encode(gen_random_bytes(16), 'hex')) CHECK (id ~ '^prj_[0-9a-f]{32}$'),
    user_id     text        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name        text        NOT NULL CHECK (length(name) > 0),
    archived_at timestamptz NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE expenses
ADD COLUMN project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE;
