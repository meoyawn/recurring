package dbtest

import (
	"context"
	"database/sql"
	"fmt"

	// Register pgx as a database/sql driver for test helpers using this package.
	_ "github.com/jackc/pgx/v5/stdlib"
)

type InsertedExpense struct {
	ProjectID   string
	Name        string
	AmountMinor int64
	Currency    string
	Recurring   string
	StartedAt   int64
	Category    string
	Comment     string
	CancelURL   string
	CanceledAt  int64
}

func SelectProjectIDByName(ctx context.Context, connectionString string, projectName string) (string, error) {
	db, err := sql.Open("pgx", connectionString)
	if err != nil {
		return "", fmt.Errorf("open postgres: %w", err)
	}
	defer func() {
		_ = db.Close()
	}()

	var projectID string
	if err := db.QueryRowContext(
		ctx,
		"SELECT id FROM projects WHERE name = $1",
		projectName,
	).Scan(&projectID); err != nil {
		return "", fmt.Errorf("select project id: %w", err)
	}
	return projectID, nil
}

func SelectProjectRole(ctx context.Context, connectionString string, projectID string) (string, error) {
	db, err := sql.Open("pgx", connectionString)
	if err != nil {
		return "", fmt.Errorf("open postgres: %w", err)
	}
	defer func() {
		_ = db.Close()
	}()

	var role string
	if err := db.QueryRowContext(
		ctx,
		"SELECT role FROM users_projects WHERE project_id = $1",
		projectID,
	).Scan(&role); err != nil {
		return "", fmt.Errorf("select project role: %w", err)
	}
	return role, nil
}

func ExpenseExists(ctx context.Context, connectionString string, expense InsertedExpense) (bool, error) {
	db, err := sql.Open("pgx", connectionString)
	if err != nil {
		return false, fmt.Errorf("open postgres: %w", err)
	}
	defer func() {
		_ = db.Close()
	}()

	var exists bool
	err = db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM expenses
			WHERE project_id = $1
			  AND name = $2
			  AND amount_minor = $3
			  AND currency = $4::char(3)
			  AND recurring = $5::interval
			  AND started_at = to_timestamp($6::double precision / 1000)
			  AND category = $7
			  AND comment = $8
			  AND cancel_url = $9
			  AND canceled_at = to_timestamp($10::double precision / 1000)
		)
	`,
		expense.ProjectID,
		expense.Name,
		expense.AmountMinor,
		expense.Currency,
		expense.Recurring,
		expense.StartedAt,
		expense.Category,
		expense.Comment,
		expense.CancelURL,
		expense.CanceledAt,
	).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("select inserted expense: %w", err)
	}
	return exists, nil
}
