package httpapi

import (
	"net/http"

	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/gen/openapi"
	"github.com/recurring/api/internal/gen/pggen"
)

func (deps *HandlerDeps) Signup(c *echo.Context) error {
	var req openapi.Signup
	MustBind(c, &req)

	querier := pggen.NewQuerier(deps.dbPool)
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
