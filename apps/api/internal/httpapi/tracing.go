package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"

	"github.com/labstack/echo/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
	"go.opentelemetry.io/otel/trace"
)

const (
	headerTraceID   = "X-Trace-Id"
	headerSpanID    = "X-Span-Id"
	headerRequestID = "X-Request-Id"
	attrRequestID   = "x-request-id"
	tracerName      = "github.com/recurring/api/internal/httpapi"
)

func traceMiddleware(provider trace.TracerProvider) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			req := c.Request()
			requestID := req.Header.Get(headerRequestID)
			if requestID == "" {
				requestID = newRequestID()
			}

			extracted := otel.GetTextMapPropagator().Extract(req.Context(), propagation.HeaderCarrier(req.Header))
			spanName := req.Method + " " + req.URL.Path
			ctx, span := provider.Tracer(tracerName).Start(extracted, spanName, trace.WithSpanKind(trace.SpanKindServer))
			defer span.End()

			spanContext := span.SpanContext()
			c.Response().Header().Set(headerTraceID, spanContext.TraceID().String())
			c.Response().Header().Set(headerSpanID, spanContext.SpanID().String())
			c.Response().Header().Set(headerRequestID, requestID)
			c.SetRequest(req.WithContext(ctx))

			err := next(c)
			route := c.Path()
			if route == "" {
				route = req.URL.Path
			}
			status := responseStatus(c.Response(), err)
			span.SetName(req.Method + " " + route)
			span.SetAttributes(
				semconv.HTTPRequestHeader(attrRequestID, requestID),
				semconv.HTTPRequestMethodKey.String(req.Method),
				semconv.HTTPRoute(route),
				semconv.HTTPResponseStatusCode(status),
			)
			if err != nil {
				span.RecordError(err)
				span.SetStatus(codes.Error, err.Error())
				span.SetAttributes(semconv.ErrorType(err))
			}
			return err
		}
	}
}

func responseStatus(resp http.ResponseWriter, err error) int {
	_, status := echo.ResolveResponseStatus(resp, err)
	if status != 0 {
		return status
	}
	var httpErr *echo.HTTPError
	if errors.As(err, &httpErr) {
		return httpErr.Code
	}
	if err != nil {
		return http.StatusInternalServerError
	}
	return http.StatusOK
}

func newRequestID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return trace.TraceID{}.String()
	}
	return hex.EncodeToString(buf[:])
}
