-- +goose Up
CREATE TABLE users (
    id          text        NOT NULL PRIMARY KEY DEFAULT ('usr_' || encode(gen_random_bytes(16), 'hex')) CHECK (id ~ '^usr_[0-9a-f]{32}$'),

    -- Stable Google OAuth subject used to link repeat Google sign-ins; email is profile data, not an identity key.
    google_sub  text        NULL     UNIQUE      CHECK (length(google_sub) > 0),

    email       text        NOT NULL CHECK (length(email) > 0),
    name        text        NULL     CHECK (name IS NULL OR length(name) > 0),
    picture_url text        NULL     CHECK (picture_url IS NULL OR length(picture_url) > 0),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    id         text        PRIMARY KEY DEFAULT ('sess_' || encode(gen_random_bytes(16), 'hex')) CHECK (id ~ '^sess_[0-9a-f]{32}$'),
    user_id    text        NOT NULL    REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL    DEFAULT now(),
    expires_at timestamptz NOT NULL    DEFAULT (now() + interval '30 days')
);
