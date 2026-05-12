package httpapi

import (
	_ "embed"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
	configgen "github.com/recurring/api/internal/gen/config"
	"github.com/recurring/api/internal/gen/pggen"
	"github.com/recurring/api/internal/serviceclient"
	echomiddleware "github.com/responsibleapi/echo-middleware"
	openapirouter "github.com/responsibleapi/echo-openapi-router"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

//go:embed recurring.openapi.yaml
var openAPISpec []byte

const (
	authorizationBearerPrefix = "Bearer"
	latencyMilliseconds       = 1000
	userIDContextKey          = "userID"
)

type echoConfig struct {
	tracerProvider trace.TracerProvider
	sheets         configgen.ServiceConfig
}

type EchoOption func(*echoConfig)

func WithTracerProvider(provider trace.TracerProvider) EchoOption {
	return func(cfg *echoConfig) {
		cfg.tracerProvider = provider
	}
}

func WithSheets(cfg configgen.ServiceConfig) EchoOption {
	return func(echoCfg *echoConfig) {
		echoCfg.sheets = cfg
	}
}

func NewEcho(pool *pgxpool.Pool, opts ...EchoOption) (*echo.Echo, error) {
	spec, err := loadOpenAPISpec()
	if err != nil {
		return nil, err
	}

	cfg := echoConfig{
		tracerProvider: otel.GetTracerProvider(),
	}
	for _, opt := range opts {
		opt(&cfg)
	}

	e := echo.New()
	e.Use(traceMiddleware(cfg.tracerProvider))
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogLatency: true,
		LogMethod:  true,
		LogURI:     true,
		LogValuesFunc: func(_ *echo.Context, v middleware.RequestLoggerValues) error {
			_, err := fmt.Fprintf(os.Stdout, "%s %s %.3fms\n", v.Method, v.URI, v.Latency.Seconds()*latencyMilliseconds)
			return err
		},
	}))

	rb, err := openapirouter.NewRouterBuilder(
		spec,
		echomiddleware.Options{
			DoNotValidateServers: true,
			Options: openapi3filter.Options{
				AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
			},
		},
	)
	if err != nil {
		return nil, err
	}

	err = rb.Security("SessionSecurity").HTTPHandler(
		"bearer",
		func(ctx *echo.Context, _ *openapi3.SecurityScheme, _ []string) error {
			return authenticateSession(ctx, pool)
		},
	)
	if err != nil {
		return nil, err
	}

	rb.AddRoute("healthCheck", health)
	rb.AddRoute("sheetsTest", sheetsTest(serviceclient.NewSheetsClient(cfg.sheets)))
	rb.AddRoute("upsertSignup", signup(pool))

	if err := rb.Mount(e); err != nil {
		return nil, err
	}

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

func authenticateSession(ctx *echo.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "database is not configured")
	}

	sessionID, ok := bearerToken(ctx.Request().Header.Get("Authorization"))
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, http.StatusText(http.StatusUnauthorized))
	}

	userID, err := pggen.NewQuerier(pool).SelectUserIDBySessionID(ctx.Request().Context(), sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return echo.NewHTTPError(http.StatusUnauthorized, http.StatusText(http.StatusUnauthorized))
	}
	if err != nil {
		return err
	}
	ctx.Set(userIDContextKey, userID)
	return nil
}

func bearerToken(header string) (string, bool) {
	scheme, token, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, authorizationBearerPrefix) {
		return "", false
	}
	token = strings.TrimSpace(token)
	return token, token != ""
}
