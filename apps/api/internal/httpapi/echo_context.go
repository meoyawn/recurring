package httpapi

import (
	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/domain"
)

const userIDContextKey = "userID"

func setUserID(c *echo.Context, userID domain.UserID) {
	c.Set(userIDContextKey, userID)
}

func userIDFromContext(c *echo.Context) (domain.UserID, bool) {
	userID, err := echo.ContextGet[domain.UserID](c, userIDContextKey)
	return userID, err == nil && userID != ""
}
