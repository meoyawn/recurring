package dbtest

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/recurring/api/internal/gen/pggen"
	"gotest.tools/v3/assert"
)

type rollbackTx struct {
	pgx.Tx
}

func TestCreateSignupSessionInsertsUserAndSession(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	tx := beginRollbackTx(ctx, t)
	q := pggen.NewQuerier(tx)

	sessionID, err := q.CreateSignupSession(ctx, pggen.CreateSignupSessionParams{
		GoogleSub:  "google-sub-create-session",
		Email:      "create-session@example.com",
		Name:       "Create Session",
		PictureURL: "https://example.com/create-session.png",
	})
	assert.NilError(t, err, "create signup session")

	var userID string
	err = tx.QueryRow(ctx, `
		SELECT users.id
		FROM users
		INNER JOIN sessions ON sessions.user_id = users.id
		WHERE sessions.id = $1
	`, sessionID).Scan(&userID)
	assert.NilError(t, err, "select created user")
	assert.Assert(t, userID != "", "created user id is empty")

	var googleSub string
	var email string
	var name *string
	var pictureURL *string
	err = tx.QueryRow(ctx, `
		SELECT google_sub, email, name, picture_url
		FROM users
		WHERE id = $1
	`, userID).Scan(&googleSub, &email, &name, &pictureURL)
	assert.NilError(t, err, "select created user profile")
	assert.Equal(t, googleSub, "google-sub-create-session", "google_sub")
	assert.Equal(t, email, "create-session@example.com", "email")
	assert.Assert(t, name != nil, "name is null")
	assert.Equal(t, *name, "Create Session", "name")
	assert.Assert(t, pictureURL != nil, "picture_url is null")
	assert.Equal(t, *pictureURL, "https://example.com/create-session.png", "picture_url")
}

func TestCreateSignupSessionUpsertsExistingGoogleUser(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	tx := beginRollbackTx(ctx, t)
	q := pggen.NewQuerier(tx)

	firstSessionID, err := q.CreateSignupSession(ctx, pggen.CreateSignupSessionParams{
		GoogleSub:  "google-sub-upsert-session",
		Email:      "first@example.com",
		Name:       "First Name",
		PictureURL: "https://example.com/first.png",
	})
	assert.NilError(t, err, "create first signup session")

	secondSessionID, err := q.CreateSignupSession(ctx, pggen.CreateSignupSessionParams{
		GoogleSub:  "google-sub-upsert-session",
		Email:      "second@example.com",
		Name:       "",
		PictureURL: "",
	})
	assert.NilError(t, err, "create second signup session")
	assert.Assert(t, firstSessionID != secondSessionID, "repeat signup returned same session id %q", secondSessionID)

	var userCount int
	err = tx.QueryRow(ctx, `
		SELECT count(*)
		FROM users
		WHERE google_sub = $1
	`, "google-sub-upsert-session").Scan(&userCount)
	assert.NilError(t, err, "count upserted users")
	assert.Equal(t, userCount, 1, "user count")

	var firstUserID string
	var secondUserID string
	err = tx.QueryRow(ctx, `SELECT user_id FROM sessions WHERE id = $1`, firstSessionID).Scan(&firstUserID)
	assert.NilError(t, err, "select first session user")
	err = tx.QueryRow(ctx, `SELECT user_id FROM sessions WHERE id = $1`, secondSessionID).Scan(&secondUserID)
	assert.NilError(t, err, "select second session user")
	assert.Equal(t, firstUserID, secondUserID, "session user")

	var email string
	var name *string
	var pictureURL *string
	err = tx.QueryRow(ctx, `
		SELECT email, name, picture_url
		FROM users
		WHERE id = $1
	`, secondUserID).Scan(&email, &name, &pictureURL)
	assert.NilError(t, err, "select upserted user")
	assert.Equal(t, email, "second@example.com", "email")
	assert.Assert(t, name == nil, "empty name should become null")
	assert.Assert(t, pictureURL == nil, "empty picture_url should become null")
}

func TestSelectUserIDBySessionID(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	tx := beginRollbackTx(ctx, t)
	q := pggen.NewQuerier(tx)

	sessionID, err := q.CreateSignupSession(ctx, pggen.CreateSignupSessionParams{
		GoogleSub:  "google-sub-select-user",
		Email:      "select-user@example.com",
		Name:       "Select User",
		PictureURL: "",
	})
	assert.NilError(t, err, "create signup session")

	gotUserID, err := q.SelectUserIDBySessionID(ctx, sessionID)
	assert.NilError(t, err, "select user id by session id")

	var wantUserID string
	err = tx.QueryRow(ctx, `SELECT user_id FROM sessions WHERE id = $1`, sessionID).Scan(&wantUserID)
	assert.NilError(t, err, "select expected user id")
	assert.Equal(t, gotUserID, wantUserID, "user id")
}

func beginRollbackTx(ctx context.Context, t *testing.T) *rollbackTx {
	t.Helper()

	tx, err := testPool.Begin(ctx)
	assert.NilError(t, err, "begin transaction")
	t.Cleanup(func() {
		err := tx.Rollback(context.WithoutCancel(ctx))
		if err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			t.Errorf("rollback transaction: %v", err)
		}
	})
	return &rollbackTx{Tx: tx}
}
