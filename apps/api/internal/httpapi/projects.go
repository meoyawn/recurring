package httpapi

import (
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/gen/openapi"
	"github.com/recurring/api/internal/gen/pggen"
)

func (h *handler) createProject(c *echo.Context) error {
	if h.dbPool == nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database is not configured")
	}

	userID, ok := userIDFromContext(c)
	if !ok {
		return echo.NewHTTPError(http.StatusInternalServerError, "authenticated user is not configured")
	}

	var req openapi.CreateProject
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid project request")
	}

	_, err := pggen.NewQuerier(h.dbPool).CreateProject(c.Request().Context(), userID.String(), req.Name)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusCreated, openapi.Project{Name: req.Name})
}
