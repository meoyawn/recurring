package domain

import "regexp"

var userIDPattern = regexp.MustCompile(`^usr_[0-9a-f]{32}$`)

type UserID string

func UserIDFromString(id string) (UserID, bool) {
	if !userIDPattern.MatchString(id) {
		return "", false
	}
	return UserID(id), true
}

func (id UserID) String() string {
	return string(id)
}
