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

		id, err := pggen.NewQuerier(deps.dbPool).CreateProject(c.Request().Context(), req.Name, userID.String())
		if err != nil {
			return err
		}

		return c.JSON(http.StatusCreated, openapi.Project{Id: id, Name: req.Name})
	}
}

func FirstProjectID(deps *HandlerDeps) echo.HandlerFunc {
	return func(c *echo.Context) error {
		userID := MustUserID(c)

		id, err := pggen.NewQuerier(deps.dbPool).FirstProjectID(c.Request().Context(), userID.String())
		if err != nil {
			return err
		}
		if id == nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "project not found")
		}

		return c.JSON(http.StatusOK, *id)
	}
}
