package domain

import "strings"

type UserID string

type SessionID string

type ProjectID string

type ExpenseID string

func UserIDFromString(id string) (UserID, bool) {
	if !strings.HasPrefix(id, "usr_") {
		return "", false
	}
	return UserID(id), true
}

func (id UserID) String() string {
	return string(id)
}

func SessionIDFromString(id string) (SessionID, bool) {
	if !strings.HasPrefix(id, "sess_") {
		return "", false
	}
	return SessionID(id), true
}

func (id SessionID) String() string {
	return string(id)
}

func ProjectIDFromString(id string) (ProjectID, bool) {
	if !strings.HasPrefix(id, "prj_") {
		return "", false
	}
	return ProjectID(id), true
}

func (id ProjectID) String() string {
	return string(id)
}

func ExpenseIDFromString(id string) (ExpenseID, bool) {
	if !strings.HasPrefix(id, "exp_") {
		return "", false
	}
	return ExpenseID(id), true
}

func (id ExpenseID) String() string {
	return string(id)
}
