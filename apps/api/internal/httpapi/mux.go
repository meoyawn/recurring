package httpapi

import (
	"fmt"
	"net/http"
	"os"

	_ "embed"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
	echomiddleware "github.com/responsibleapi/echo-middleware"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

//go:embed recurring.openapi.yaml
var openAPISpec []byte

type echoConfig struct {
	tracerProvider trace.TracerProvider
	propagator     propagation.TextMapPropagator
}

type EchoOption func(*echoConfig)

func WithTracerProvider(provider trace.TracerProvider) EchoOption {
	return func(cfg *echoConfig) {
		cfg.tracerProvider = provider
	}
}

func NewEcho(pool *pgxpool.Pool, opts ...EchoOption) (*echo.Echo, error) {
	spec, err := loadOpenAPISpec()
	if err != nil {
		return nil, err
	}

	cfg := echoConfig{
		tracerProvider: otel.GetTracerProvider(),
		propagator:     otel.GetTextMapPropagator(),
	}
	for _, opt := range opts {
		opt(&cfg)
	}

	e := echo.New()
	e.Use(traceMiddleware(cfg.tracerProvider, cfg.propagator))
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogLatency: true,
		LogMethod:  true,
		LogURI:     true,
		LogValuesFunc: func(c *echo.Context, v middleware.RequestLoggerValues) error {
			_, err := fmt.Fprintf(os.Stdout, "%s %s %.3fms\n", v.Method, v.URI, v.Latency.Seconds()*1000)
			return err
		},
	}))
	e.Use(echomiddleware.OapiRequestValidatorWithOptions(spec, &echomiddleware.Options{
		DoNotValidateServers: true,
		Options: openapi3filter.Options{
			AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
		},
	}))
	e.GET("/healthz", health)
	e.POST("/v1/signup", signup(pool))

	return e, nil
}

func loadOpenAPISpec() (*openapi3.T, error) {
	spec, err := openapi3.NewLoader().LoadFromData(openAPISpec)
	if err != nil {
		return nil, fmt.Errorf("load embedded OpenAPI spec: %w", err)
	}
	return spec, nil
}

func health(c *echo.Context) error {
	return c.NoContent(http.StatusNoContent)
}
