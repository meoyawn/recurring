package telemetry

import (
	"testing"

	"go.opentelemetry.io/otel/attribute"
	"gotest.tools/v3/assert"
)

func TestResourceAttributesIncludeServiceVersion(t *testing.T) {
	t.Parallel()

	attrs := resourceAttributes(startConfig{serviceVersion: "v1.2.3"})

	assertAttribute(t, attrs, "service.name", "recurring-api")
	assertAttribute(t, attrs, "service.version", "v1.2.3")
}

func TestResourceAttributesSkipEmptyServiceVersion(t *testing.T) {
	t.Parallel()

	attrs := resourceAttributes(startConfig{})

	assertAttribute(t, attrs, "service.name", "recurring-api")
	for _, attr := range attrs {
		assert.Assert(t, string(attr.Key) != "service.version", "service.version should not be present")
	}
}

func assertAttribute(t *testing.T, attrs []attribute.KeyValue, key string, value string) {
	t.Helper()

	for _, attr := range attrs {
		if string(attr.Key) == key {
			assert.Equal(t, attr.Value.AsString(), value)
			return
		}
	}
	t.Fatalf("attribute %q not found", key)
}
