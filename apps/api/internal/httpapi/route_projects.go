package httpapi

import (
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/gen/openapi"
	"github.com/recurring/api/internal/gen/pggen"
)

func CreateProject(deps *HandlerDeps) echo.HandlerFunc {
	return func(c *echo.Context) error {
		userID := MustUserID(c)
		var req openapi.CreateProject
		MustBind(c, &req)

		_, err := pggen.NewQuerier(deps.dbPool).CreateProject(c.Request().Context(), userID.String(), req.Name)
		if err != nil {
			return err
		}

		return c.JSON(http.StatusCreated, openapi.Project{Name: req.Name})
	}
}
