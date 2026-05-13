package httpapi

import (
	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/domain"
)

const UserIDContextKey = "userID"

func setUserID(c *echo.Context, userID domain.UserID) {
	c.Set(UserIDContextKey, userID)
}

func UserIDFromContext(c *echo.Context) (domain.UserID, bool) {
	userID, err := echo.ContextGet[domain.UserID](c, UserIDContextKey)
	return userID, err == nil && userID != ""
}

func MustUserID(c *echo.Context) domain.UserID {
	userID, ok := UserIDFromContext(c)
	if !ok {
		panic("authenticated user is not configured")
	}
	return userID
}

func MustBind[T any](c *echo.Context) T {
	var value T
	if err := c.Bind(&value); err != nil {
		panic(err)
	}
	return value
}
