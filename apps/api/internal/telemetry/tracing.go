package telemetry

import (
	"context"
	"net/url"
	"strings"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	configgen "github.com/recurring/api/internal/gen/config"
)

const (
	serviceName = "recurring-api"
	localEnv    = "local"
)

func Start(ctx context.Context, cfg configgen.TelemetryConfig) (func(context.Context) error, error) {
	otel.SetTextMapPropagator(textMapPropagator())

	res, err := resource.New(ctx,
		resource.WithFromEnv(),
		resource.WithTelemetrySDK(),
		resource.WithAttributes(
			attribute.String("service.name", serviceName),
			attribute.String("deployment.environment", deploymentEnvironment(cfg)),
		),
	)
	if err != nil {
		return nil, err
	}

	opts := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(res),
	}
	if traceExporterConfigured(cfg) {
		exporter, err := otlptracehttp.New(ctx, traceExporterOptions(cfg)...)
		if err != nil {
			return nil, err
		}
		opts = append(opts, sdktrace.WithBatcher(exporter))
	}

	provider := sdktrace.NewTracerProvider(opts...)
	otel.SetTracerProvider(provider)
	return provider.Shutdown, nil
}

func textMapPropagator() propagation.TextMapPropagator {
	return propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	)
}

func traceExporterConfigured(cfg configgen.TelemetryConfig) bool {
	return cfg.HasOtlpEndpoint() || cfg.HasOtlpTracesEndpoint()
}

func traceExporterOptions(cfg configgen.TelemetryConfig) []otlptracehttp.Option {
	if cfg.HasOtlpTracesEndpoint() {
		return []otlptracehttp.Option{
			otlptracehttp.WithEndpointURL(cfg.GetOtlpTracesEndpoint()),
		}
	}
	if cfg.HasOtlpEndpoint() {
		return []otlptracehttp.Option{
			otlptracehttp.WithEndpointURL(traceEndpointURL(cfg.GetOtlpEndpoint())),
		}
	}
	return nil
}

func traceEndpointURL(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/v1/traces"
	return u.String()
}

func deploymentEnvironment(cfg configgen.TelemetryConfig) string {
	if cfg.DeploymentEnvironment != "" {
		return cfg.DeploymentEnvironment
	}
	return localEnv
}
