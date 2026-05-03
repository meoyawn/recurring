-- +goose Up
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.expenses (
    id           text PRIMARY KEY
    DEFAULT ('exp_' || encode(gen_random_bytes(16), 'hex'))
    CHECK (id ~ '^exp_[0-9a-f]{32}$'),
    name         text NOT NULL CHECK (length(name) > 0),
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    currency     char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
    recurring    interval CHECK (
        recurring IS NULL
        OR recurring > interval '0 seconds'
    ),
    started_at   timestamptz                                NOT NULL,
    category     text CHECK (
        category IS NULL
        OR length(category) > 0
    ),
    comment      text CHECK (
        comment IS NULL
        OR length(comment) > 0
    ),
    cancel_url   text,
    canceled_at  timestamptz,
    created_at   timestamptz                                NOT NULL DEFAULT now(),
    updated_at   timestamptz                                NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS public.expenses;
DROP EXTENSION IF EXISTS pgcrypto;
