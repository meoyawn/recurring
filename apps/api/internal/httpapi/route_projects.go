package httpapi

import (
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/gen/openapi"
	"github.com/recurring/api/internal/gen/pggen"
)

func (deps *HandlerDeps) CreateProject(c *echo.Context) error {
	userID := MustUserID(c)
	var req openapi.CreateProject
	MustBind(c, &req)

	id, err := pggen.NewQuerier(deps.dbPool).CreateProject(c.Request().Context(), req.Name, userID.String())
	if err != nil {
		return err
	}

	return c.JSON(http.StatusCreated, openapi.Project{Id: openapi.ProjectID(id), Name: req.Name})
}

func (deps *HandlerDeps) ListProjects(c *echo.Context) error {
	userID := MustUserID(c)

	rows, err := pggen.NewQuerier(deps.dbPool).ListProjects(c.Request().Context(), userID.String())
	if err != nil {
		return err
	}

	projects := make([]openapi.Project, 0, len(rows))
	for _, row := range rows {
		archivedAt, err := optionalInt64Value(row.ArchivedAtUnixMillis)
		if err != nil {
			return err
		}
		projects = append(projects, openapi.Project{
			Id:         openapi.ProjectID(stringValue(row.ID)),
			Name:       stringValue(row.Name),
			ArchivedAt: archivedAt,
		})
	}

	return c.JSON(http.StatusOK, projects)
}

func (deps *HandlerDeps) FirstProjectID(c *echo.Context) error {
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
