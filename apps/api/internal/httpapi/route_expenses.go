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

func CreateExpense(deps *HandlerDeps) echo.HandlerFunc {
	return func(c *echo.Context) error {
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
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func int64Value(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}
