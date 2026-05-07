package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewEchoHealthz(t *testing.T) {
	t.Parallel()

	e, err := NewEcho(nil)
	if err != nil {
		t.Fatalf("NewEcho: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /healthz status = %d, want %d", rec.Code, http.StatusOK)
	}
	if rec.Body.String() != "" {
		t.Fatalf("GET /healthz body = %q, want empty", rec.Body.String())
	}
}

func TestNewEchoOpenAPIValidation(t *testing.T) {
	t.Parallel()

	e, err := NewEcho(nil)
	if err != nil {
		t.Fatalf("NewEcho: %v", err)
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/signup", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("POST /v1/signup status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}
