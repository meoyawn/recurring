package apitest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

const (
	jaegerQueryOrigin = "http://jaeger.localhost:16686"
	jaegerPollDelay   = 100 * time.Millisecond
)

func containsTraceValue(value any, needle string) bool {
	switch x := value.(type) {
	case string:
		return x == needle
	case []any:
		for _, item := range x {
			if containsTraceValue(item, needle) {
				return true
			}
		}
	case map[string]any:
		for _, item := range x {
			if containsTraceValue(item, needle) {
				return true
			}
		}
	}
	return false
}

func jaegerTraceContains(ctx context.Context, traceID string, needle string) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jaegerQueryOrigin+"/api/v3/traces/"+traceID, http.NoBody)
	if err != nil {
		return false, fmt.Errorf("create Jaeger trace lookup request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, nil
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if !isHTTPSuccess(resp.StatusCode) {
		return false, nil
	}

	var body any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return false, fmt.Errorf("decode Jaeger trace lookup response: %w", err)
	}
	return containsTraceValue(body, traceID) && containsTraceValue(body, needle), nil
}

func waitForJaegerTrace(ctx context.Context, traceID string, needle string) error {
	ticker := time.NewTicker(jaegerPollDelay)
	defer ticker.Stop()

	for {
		exists, err := jaegerTraceContains(ctx, traceID, needle)
		if err != nil {
			return err
		}
		if exists {
			return nil
		}

		select {
		case <-ctx.Done():
			return fmt.Errorf("jaeger trace %s lookup failed: %w", traceID, ctx.Err())
		case <-ticker.C:
		}
	}
}

func isHTTPSuccess(statusCode int) bool {
	return statusCode >= http.StatusOK && statusCode < http.StatusMultipleChoices
}
