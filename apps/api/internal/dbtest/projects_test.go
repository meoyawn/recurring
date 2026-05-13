package dbtest

import (
	"context"
	"testing"

	"github.com/recurring/api/internal/gen/pggen"
	"gotest.tools/v3/assert"
)

type userProjectLink struct {
	ProjectID string
	Name      string
	Role      string
}

const ownerRole = "owner"

func TestFirstProjectIDReturnsExistingProjectWithoutInsert(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	tx := beginRollbackTx(ctx, t)
	q := pggen.NewQuerier(tx)
	userID := insertUser(ctx, t, tx, "first-project-existing@example.com")
	projectID := insertProject(ctx, t, tx, "Existing")
	linkProject(ctx, t, tx, userID, projectID, ownerRole)
	otherUserID := insertUser(ctx, t, tx, "first-project-existing-other@example.com")
	otherProjectID := insertProject(ctx, t, tx, "Other Existing")
	linkProject(ctx, t, tx, otherUserID, otherProjectID, ownerRole)
	userProjectCountBefore := countUserProjects(ctx, t, tx, userID)
	otherUserProjectCountBefore := countUserProjects(ctx, t, tx, otherUserID)

	gotProjectID, err := q.FirstProjectID(ctx, userID)
	assert.NilError(t, err, "first project id")
	assert.Assert(t, gotProjectID != nil, "first project id is null")
	assert.Equal(t, *gotProjectID, projectID, "first project id")
	assert.Equal(t, countUserProjects(ctx, t, tx, userID), userProjectCountBefore, "user project count")
	assert.Equal(t, countUserProjects(ctx, t, tx, otherUserID), otherUserProjectCountBefore, "other user project count")
	assert.DeepEqual(t, selectUserProjectLinks(ctx, t, tx, userID), []userProjectLink{
		{
			ProjectID: projectID,
			Name:      "Existing",
			Role:      ownerRole,
		},
	})
	assert.Equal(t, selectProjectName(ctx, t, tx, otherProjectID), "Other Existing", "other project name")
}

func TestFirstProjectIDCreatesDefaultProject(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	tx := beginRollbackTx(ctx, t)
	q := pggen.NewQuerier(tx)
	userID := insertUser(ctx, t, tx, "first-project-default@example.com")
	otherUserID := insertUser(ctx, t, tx, "first-project-default-other@example.com")
	otherProjectID := insertProject(ctx, t, tx, "Other Default")
	linkProject(ctx, t, tx, otherUserID, otherProjectID, ownerRole)

	gotProjectID, err := q.FirstProjectID(ctx, userID)
	assert.NilError(t, err, "first project id")
	assert.Assert(t, gotProjectID != nil, "first project id is null")
	assert.Equal(t, countUserProjects(ctx, t, tx, userID), 1, "user project count")
	assert.Equal(t, countUserProjects(ctx, t, tx, otherUserID), 1, "other user project count")
	assert.DeepEqual(t, selectUserProjectLinks(ctx, t, tx, userID), []userProjectLink{
		{
			ProjectID: *gotProjectID,
			Name:      "Home",
			Role:      ownerRole,
		},
	})

	var projectName string
	var role string
	err = tx.QueryRow(ctx, `
		SELECT projects.name, users_projects.role
		FROM projects
		INNER JOIN users_projects ON users_projects.project_id = projects.id
		WHERE users_projects.user_id = $1 AND projects.id = $2
	`, userID, *gotProjectID).Scan(&projectName, &role)
	assert.NilError(t, err, "select default project")
	assert.Equal(t, projectName, "Home", "default project name")
	assert.Equal(t, role, ownerRole, "default project role")
	assert.Equal(t, selectProjectName(ctx, t, tx, otherProjectID), "Other Default", "other project name")

	secondProjectID, err := q.FirstProjectID(ctx, userID)
	assert.NilError(t, err, "second first project id")
	assert.Assert(t, secondProjectID != nil, "second first project id is null")
	assert.Equal(t, *secondProjectID, *gotProjectID, "second first project id")
	assert.Equal(t, countUserProjects(ctx, t, tx, userID), 1, "user project count after second call")
	assert.Equal(t, countUserProjects(ctx, t, tx, otherUserID), 1, "other user project count after second call")
	assert.DeepEqual(t, selectUserProjectLinks(ctx, t, tx, userID), []userProjectLink{
		{
			ProjectID: *gotProjectID,
			Name:      "Home",
			Role:      ownerRole,
		},
	})
}

func insertUser(ctx context.Context, t *testing.T, tx *rollbackTx, email string) string {
	t.Helper()

	var userID string
	err := tx.QueryRow(ctx, `
		INSERT INTO users (email)
		VALUES ($1)
		RETURNING id
	`, email).Scan(&userID)
	assert.NilError(t, err, "insert user")
	return userID
}

func insertProject(ctx context.Context, t *testing.T, tx *rollbackTx, name string) string {
	t.Helper()

	var projectID string
	err := tx.QueryRow(ctx, `
		INSERT INTO projects (name)
		VALUES ($1)
		RETURNING id
	`, name).Scan(&projectID)
	assert.NilError(t, err, "insert project")
	return projectID
}

func linkProject(ctx context.Context, t *testing.T, tx *rollbackTx, userID string, projectID string, role string) {
	t.Helper()

	_, err := tx.Exec(ctx, `
		INSERT INTO users_projects (user_id, project_id, role)
		VALUES ($1, $2, $3)
	`, userID, projectID, role)
	assert.NilError(t, err, "link project")
}

func countUserProjects(ctx context.Context, t *testing.T, tx *rollbackTx, userID string) int {
	t.Helper()

	var count int
	err := tx.QueryRow(ctx, `
		SELECT count(*)
		FROM users_projects
		WHERE user_id = $1
	`, userID).Scan(&count)
	assert.NilError(t, err, "count user projects")
	return count
}

func selectProjectName(ctx context.Context, t *testing.T, tx *rollbackTx, projectID string) string {
	t.Helper()

	var name string
	err := tx.QueryRow(ctx, `
		SELECT name
		FROM projects
		WHERE id = $1
	`, projectID).Scan(&name)
	assert.NilError(t, err, "select project name")
	return name
}

func selectUserProjectLinks(ctx context.Context, t *testing.T, tx *rollbackTx, userID string) []userProjectLink {
	t.Helper()

	rows, err := tx.Query(ctx, `
		SELECT projects.id, projects.name, users_projects.role
		FROM projects
		INNER JOIN users_projects ON users_projects.project_id = projects.id
		WHERE users_projects.user_id = $1
		ORDER BY projects.id
	`, userID)
	assert.NilError(t, err, "select user project links")
	defer rows.Close()

	var links []userProjectLink
	for rows.Next() {
		var link userProjectLink
		err = rows.Scan(&link.ProjectID, &link.Name, &link.Role)
		assert.NilError(t, err, "scan user project link")
		links = append(links, link)
	}
	assert.NilError(t, rows.Err(), "iterate user project links")
	return links
}
