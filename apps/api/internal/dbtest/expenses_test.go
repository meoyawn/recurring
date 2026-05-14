package dbtest

import (
	"testing"

	"github.com/recurring/api/internal/gen/pggen"
	"gotest.tools/v3/assert"
)

func TestListExpensesReturnsOwnedProjectExpenses(t *testing.T) {
	t.Parallel()

	ctx := t.Context()
	tx := beginRollbackTx(ctx, t)
	q := pggen.NewQuerier(tx)
	userID := insertUser(ctx, t, tx, "list-expenses@example.com")
	otherUserID := insertUser(ctx, t, tx, "list-expenses-other@example.com")
	projectID := insertProject(ctx, t, tx, "Expenses")
	otherProjectID := insertProject(ctx, t, tx, "Other Expenses")
	linkProject(ctx, t, tx, userID, projectID, ownerRole)
	linkProject(ctx, t, tx, otherUserID, otherProjectID, "viewer")

	const startedAt = 1777636800000
	const canceledAt = "1780315200000"
	expenseID, err := q.InsertExpense(ctx, pggen.InsertExpenseParams{
		ProjectID:            projectID,
		UserID:               userID,
		Name:                 "Rent",
		AmountMinor:          125000,
		Currency:             "USD",
		Recurring:            "P1M",
		StartedAtUnixMillis:  startedAt,
		Category:             "Housing",
		Comment:              "Monthly rent",
		CancelURL:            "https://example.com/cancel",
		CanceledAtUnixMillis: canceledAt,
	})
	assert.NilError(t, err, "insert expense")
	_, err = q.InsertExpense(ctx, pggen.InsertExpenseParams{
		ProjectID:           otherProjectID,
		UserID:              otherUserID,
		Name:                "Other Rent",
		AmountMinor:         1000,
		Currency:            "USD",
		StartedAtUnixMillis: startedAt,
	})
	assert.NilError(t, err, "insert other expense")

	rows, err := q.ListExpenses(ctx, projectID, userID)
	assert.NilError(t, err, "list expenses")
	assert.Equal(t, len(rows), 1, "expense count")
	assert.Equal(t, requireString(t, rows[0].ID, "expense id"), expenseID, "expense id")
	assert.Equal(t, requireString(t, rows[0].Name, "expense name"), "Rent", "expense name")
	assert.Equal(t, rows[0].AmountMinor, int64(125000), "amount minor")
	assert.Equal(t, requireString(t, rows[0].Currency, "currency"), "USD", "currency")
	assert.Equal(t, requireString(t, rows[0].Recurring, "recurring"), "P1M", "recurring")
	assert.Equal(t, rows[0].StartedAtUnixMillis, int64(startedAt), "started_at")
	assert.Equal(t, requireString(t, rows[0].Category, "category"), "Housing", "category")
	assert.Equal(t, requireString(t, rows[0].Comment, "comment"), "Monthly rent", "comment")
	assert.Equal(t, requireString(t, rows[0].CancelURL, "cancel_url"), "https://example.com/cancel", "cancel_url")
	assert.Equal(t, requireString(t, rows[0].CanceledAtUnixMillis, "canceled_at"), canceledAt, "canceled_at")

	otherRows, err := q.ListExpenses(ctx, otherProjectID, userID)
	assert.NilError(t, err, "list other expenses")
	assert.DeepEqual(t, otherRows, []pggen.ListExpensesRow{})
}
