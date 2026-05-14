-- +goose Up
ALTER TABLE expenses
ALTER COLUMN id SET DEFAULT ('exp_' || encode(gen_random_bytes(8), 'hex')),
DROP CONSTRAINT IF EXISTS expenses_id_check,
ADD CHECK (id ~ '^exp_');

ALTER TABLE users
ALTER COLUMN id SET DEFAULT ('usr_' || encode(gen_random_bytes(8), 'hex')),
DROP CONSTRAINT IF EXISTS users_id_check,
ADD CHECK (id ~ '^usr_');

ALTER TABLE sessions
ALTER COLUMN id SET DEFAULT ('sess_' || encode(gen_random_bytes(8), 'hex')),
DROP CONSTRAINT IF EXISTS sessions_id_check,
ADD CHECK (id ~ '^sess_');

ALTER TABLE projects
ALTER COLUMN id SET DEFAULT ('prj_' || encode(gen_random_bytes(8), 'hex')),
DROP CONSTRAINT IF EXISTS projects_id_check,
ADD CHECK (id ~ '^prj_');
