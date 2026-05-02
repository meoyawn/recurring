package httpapi

import (
	"fmt"
	"net/http"

	_ "embed"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/labstack/echo/v5"
	echomiddleware "github.com/responsibleapi/echo-middleware"
)

//go:embed recurring.openapi.yaml
var openAPISpec []byte

func NewEcho() (*echo.Echo, error) {
	spec, err := loadOpenAPISpec()
	if err != nil {
		return nil, err
	}

	e := echo.New()
	e.Use(echomiddleware.OapiRequestValidatorWithOptions(spec, &echomiddleware.Options{
		DoNotValidateServers: true,
		Options: openapi3filter.Options{
			AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
		},
	}))
	e.GET("/healthz", health)

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
	return c.NoContent(http.StatusOK)
}
