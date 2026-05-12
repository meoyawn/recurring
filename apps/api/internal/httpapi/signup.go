package httpapi

import (
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/gen/openapi"
	"github.com/recurring/api/internal/gen/pggen"
)

func (h *handler) signup(c *echo.Context) error {
	if h.dbPool == nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database is not configured")
	}

	var req openapi.Signup
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid signup request")
	}

	querier := pggen.NewQuerier(h.dbPool)
	sessionID, err := querier.CreateSignupSession(c.Request().Context(), pggen.CreateSignupSessionParams{
		GoogleSub:  req.GoogleSub,
		Email:      req.Email,
		Name:       req.GetName(),
		PictureURL: req.GetPictureUrl(),
	})
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, openapi.SignupSession{SessionId: sessionID})
}
