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
	"github.com/recurring/api/internal/domain"
	configgen "github.com/recurring/api/internal/gen/config"
	"github.com/recurring/api/internal/gen/pggen"
	sheetsgen "github.com/recurring/api/internal/gen/sheets"
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
)

type echoConfig struct {
	tracerProvider trace.TracerProvider
	sheets         configgen.ServiceConfig
}

type EchoOption func(*echoConfig)

type HandlerDeps struct {
	dbPool       *pgxpool.Pool
	sheetsClient *sheetsgen.APIClient
}

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

func NewEcho(dbPool *pgxpool.Pool, opts ...EchoOption) (*echo.Echo, error) {
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
				MultiError:         true,
			},
			ErrorHandler: validationErrorHandler,
		},
	)
	if err != nil {
		return nil, err
	}

	deps, err := newHandlerDeps(dbPool, cfg)
	if err != nil {
		return nil, err
	}
	deps.registerRoutes(rb)
	if err := rb.Mount(e); err != nil {
		return nil, err
	}

	return e, nil
}

func newHandlerDeps(dbPool *pgxpool.Pool, cfg echoConfig) (*HandlerDeps, error) {
	if dbPool == nil {
		return nil, errors.New("database is not configured")
	}

	sheetsClient := serviceclient.NewSheetsClient(cfg.sheets)
	if sheetsClient == nil {
		return nil, errors.New("sheets client is not configured")
	}
	return &HandlerDeps{
		dbPool:       dbPool,
		sheetsClient: sheetsClient,
	}, nil
}

func (deps *HandlerDeps) registerRoutes(rb *openapirouter.RouterBuilder) {
	rb.Security("SessionSecurity", func(ctx *echo.Context, _ *openapi3.SecurityScheme, _ []string) error {
		return deps.authenticateSession(ctx)
	})

	rb.AddRoute("healthCheck", func(ctx *echo.Context) error {
		return ctx.NoContent(http.StatusNoContent)
	})
	rb.AddRoute("sheetsTest", SheetsTest(deps))
	rb.AddRoute("upsertSignup", Signup(deps))
	rb.AddRoute("createProject", CreateProject(deps))
	rb.AddRoute("createExpense", CreateExpense(deps))
}

func loadOpenAPISpec() (*openapi3.T, error) {
	spec, err := openapi3.NewLoader().LoadFromData(openAPISpec)
	if err != nil {
		return nil, fmt.Errorf("load embedded OpenAPI spec: %w", err)
	}
	return spec, nil
}

func (deps *HandlerDeps) authenticateSession(ctx *echo.Context) error {
	sessionID, ok := bearerToken(ctx.Request().Header.Get("Authorization"))
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, http.StatusText(http.StatusUnauthorized))
	}

	rawUserID, err := pggen.NewQuerier(deps.dbPool).SelectUserIDBySessionID(ctx.Request().Context(), sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return echo.NewHTTPError(http.StatusUnauthorized, http.StatusText(http.StatusUnauthorized))
	}
	if err != nil {
		return err
	}
	userID, ok := domain.UserIDFromString(rawUserID)
	if !ok {
		return echo.NewHTTPError(http.StatusUnauthorized, "authenticated user is invalid")
	}
	setUserID(ctx, userID)
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
