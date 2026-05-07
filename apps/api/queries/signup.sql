-- CreateSignupSession upserts a Google user and opens a session.
-- name: CreateSignupSession :one
WITH upserted AS (
    INSERT INTO public.users (google_sub, email, name, picture_url)
    VALUES (
        pggen.arg('GoogleSub'),
        pggen.arg('Email'),
        CASE WHEN pggen.arg('NameSet')::boolean THEN pggen.arg('Name')::text ELSE NULL END,
        CASE WHEN pggen.arg('PictureURLSet')::boolean THEN pggen.arg('PictureURL')::text ELSE NULL END
    )
    ON CONFLICT (google_sub) DO UPDATE
    SET email = excluded.email,
        name = excluded.name,
        picture_url = excluded.picture_url,
        updated_at = now()
    RETURNING id
)
INSERT INTO public.sessions (user_id)
SELECT id FROM upserted
RETURNING id;
