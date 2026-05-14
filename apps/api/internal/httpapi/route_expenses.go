package httpapi

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/gen/openapi"
	"github.com/recurring/api/internal/gen/pggen"
)

func (deps *HandlerDeps) CreateExpense(c *echo.Context) error {
	userID := MustUserID(c)
	var req openapi.CreateExpense
	MustBind(c, &req)

	id, err := pggen.NewQuerier(deps.dbPool).InsertExpense(c.Request().Context(), pggen.InsertExpenseParams{
		ProjectID:            c.Param("id"),
		UserID:               userID.String(),
		Name:                 req.Name,
		AmountMinor:          req.Money.Amount,
		Currency:             req.Money.Currency,
		Recurring:            stringValue(req.Recurring),
		StartedAtUnixMillis:  req.StartedAt,
		Category:             stringValue(req.Category),
		Comment:              stringValue(req.Comment),
		CancelURL:            stringValue(req.CancelUrl),
		CanceledAtUnixMillis: int64Value(req.CanceledAt),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return echo.NewHTTPError(http.StatusNotFound, "project not found")
	}
	if err != nil {
		return err
	}

	return c.JSON(http.StatusCreated, openapi.Expense{
		Id:         id,
		Name:       req.Name,
		Money:      req.Money,
		Recurring:  req.Recurring,
		StartedAt:  req.StartedAt,
		Category:   req.Category,
		Comment:    req.Comment,
		CancelUrl:  req.CancelUrl,
		CanceledAt: req.CanceledAt,
	})
}

func (deps *HandlerDeps) ListExpenses(c *echo.Context) error {
	userID := MustUserID(c)

	rows, err := pggen.NewQuerier(deps.dbPool).ListExpenses(c.Request().Context(), c.Param("id"), userID.String())
	if err != nil {
		return err
	}

	expenses := make([]openapi.Expense, 0, len(rows))
	for _, row := range rows {
		canceledAt, err := optionalInt64Value(row.CanceledAtUnixMillis)
		if err != nil {
			return err
		}
		expenses = append(expenses, openapi.Expense{
			Id:   stringValue(row.ID),
			Name: stringValue(row.Name),
			Money: openapi.Money{
				Amount:   row.AmountMinor,
				Currency: stringValue(row.Currency),
			},
			Recurring:  row.Recurring,
			StartedAt:  row.StartedAtUnixMillis,
			Category:   row.Category,
			Comment:    row.Comment,
			CancelUrl:  row.CancelURL,
			CanceledAt: canceledAt,
		})
	}

	return c.JSON(http.StatusOK, expenses)
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func optionalInt64Value(value *string) (*int64, error) {
	if value == nil {
		return nil, nil
	}
	parsed, err := strconv.ParseInt(*value, 10, 64)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func int64Value(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}
