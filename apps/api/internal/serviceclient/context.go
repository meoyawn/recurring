package serviceclient

import "context"

type contextKey string

const (
	idempotencyKeyContextKey contextKey = "idempotency-key"
	retryableContextKey      contextKey = "retryable"
)

func WithIdempotencyKey(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, idempotencyKeyContextKey, key)
}

func IdempotencyKey(ctx context.Context) string {
	value, _ := ctx.Value(idempotencyKeyContextKey).(string)
	return value
}

func WithRetryable(ctx context.Context, retryable bool) context.Context {
	return context.WithValue(ctx, retryableContextKey, retryable)
}

func Retryable(ctx context.Context) bool {
	value, _ := ctx.Value(retryableContextKey).(bool)
	return value
}
