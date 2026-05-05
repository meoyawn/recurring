package httpapi

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"
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

		var sessionID string
		err := pool.QueryRow(c.Request().Context(), `
			WITH upserted AS (
				INSERT INTO public.users (google_sub, email, name, picture_url)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (google_sub) DO UPDATE
				SET email = excluded.email,
					name = excluded.name,
					picture_url = excluded.picture_url,
					updated_at = now()
				RETURNING id
			)
			INSERT INTO public.sessions (user_id)
			SELECT id FROM upserted
			RETURNING id
		`, req.GoogleSub, req.Email, req.Name, req.PictureURL).Scan(&sessionID)
		if err != nil {
			return err
		}

		return c.JSON(http.StatusOK, signupResponse{SessionID: sessionID})
	}
}
