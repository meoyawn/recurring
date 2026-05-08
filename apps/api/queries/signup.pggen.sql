-- CreateSignupSession upserts a Google user and opens a session.
-- name: CreateSignupSession :one
WITH upserted AS (
    INSERT INTO public.users (google_sub, email, name, picture_url)
    VALUES (
        pggen.arg('GoogleSub'),
        pggen.arg('Email'),
        NULLIF(pggen.arg('Name'), ''),
        NULLIF(pggen.arg('PictureURL'), '')
    )
    ON CONFLICT (google_sub) DO UPDATE
    SET email = excluded.email,
    name = excluded.name,
    picture_url = excluded.picture_url,
    updated_at = NOW()
    RETURNING id
)

INSERT INTO public.sessions (user_id)
SELECT id FROM upserted
RETURNING id;
