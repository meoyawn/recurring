package domain

import "strings"

type UserID string

func UserIDFromString(id string) (UserID, bool) {
	if !strings.HasPrefix(id, "usr_") {
		return "", false
	}
	return UserID(id), true
}

func (id UserID) String() string {
	return string(id)
}
