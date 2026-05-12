package telemetry

import (
	"context"
	"net/url"
	"strings"

	configgen "github.com/recurring/api/internal/gen/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const (
	serviceName = "recurring-api"
)

type startConfig struct {
	serviceVersion string
}

// Option configures telemetry startup.
type Option func(*startConfig)

// WithServiceVersion configures the service.version resource attribute.
func WithServiceVersion(version string) Option {
	return func(cfg *startConfig) {
		cfg.serviceVersion = version
	}
}

func Start(ctx context.Context, cfg configgen.TelemetryConfig, opts ...Option) (func(context.Context) error, error) {
	startCfg := startConfig{}
	for _, opt := range opts {
		opt(&startCfg)
	}

	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	res, err := resource.New(ctx,
		resource.WithFromEnv(),
		resource.WithTelemetrySDK(),
		resource.WithAttributes(
			resourceAttributes(startCfg)...,
		),
	)
	if err != nil {
		return nil, err
	}

	traceOpts := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(res),
	}
	if traceExporterConfigured(cfg) {
		exporter, err := otlptracehttp.New(ctx, traceExporterOptions(cfg)...)
		if err != nil {
			return nil, err
		}
		traceOpts = append(traceOpts, sdktrace.WithBatcher(exporter))
	}

	provider := sdktrace.NewTracerProvider(traceOpts...)
	otel.SetTracerProvider(provider)
	return provider.Shutdown, nil
}

func resourceAttributes(cfg startConfig) []attribute.KeyValue {
	attrs := []attribute.KeyValue{
		attribute.String("service.name", serviceName),
	}
	if cfg.serviceVersion != "" {
		attrs = append(attrs, attribute.String("service.version", cfg.serviceVersion))
	}
	return attrs
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
