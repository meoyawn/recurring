package httpapi

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/gen/pggen"
)

type signupRequest struct {
	GoogleSub  string  `json:"google_sub"`
	Email      string  `json:"email"`
	Name       *string `json:"name"`
	PictureURL *string `json:"picture_url"`
}

type signupResponse struct {
	SessionID string `json:"session_id"`
}

func signup(pool *pgxpool.Pool) echo.HandlerFunc {
	return func(c *echo.Context) error {
		if pool == nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "database is not configured")
		}

		var req signupRequest
		if err := c.Bind(&req); err != nil {
			return echo.NewHTTPError(http.StatusBadRequest, "invalid signup request")
		}

		name, nameSet := optionalString(req.Name)
		pictureURL, pictureURLSet := optionalString(req.PictureURL)

		sessionID, err := pggen.NewQuerier(pool).CreateSignupSession(c.Request().Context(), pggen.CreateSignupSessionParams{
			GoogleSub:     req.GoogleSub,
			Email:         req.Email,
			NameSet:       nameSet,
			Name:          name,
			PictureURLSet: pictureURLSet,
			PictureURL:    pictureURL,
		})
		if err != nil {
			return err
		}

		return c.JSON(http.StatusOK, signupResponse{SessionID: sessionID})
	}
}

func optionalString(value *string) (string, bool) {
	if value == nil {
		return "", false
	}
	return *value, true
}
