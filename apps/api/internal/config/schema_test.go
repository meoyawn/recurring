package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	koanfyaml "github.com/knadh/koanf/parsers/yaml"
	"github.com/xeipuuv/gojsonschema"
)

// TestConfigFilesMatchSchema validates app config files before deployment.
func TestConfigFilesMatchSchema(t *testing.T) {
	t.Parallel()

	configJSONSchema := mustOpenAPIToJSONSchema(t, filepath.Join("..", "..", "config", "schema.openapi.yaml"))
	for _, name := range []string{"dev.yaml", "test.yaml"} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			configYAML := mustParseYAML(t, filepath.Join("..", "..", "config", name))
			result, err := gojsonschema.Validate(
				gojsonschema.NewGoLoader(configJSONSchema),
				gojsonschema.NewGoLoader(configYAML),
			)
			if err != nil {
				t.Fatalf("validate config/%s against recurring config schema: %v", name, err)
			}
			if result.Valid() {
				return
			}

			var messages []string
			for _, desc := range result.Errors() {
				messages = append(messages, desc.String())
			}
			t.Fatalf("config/%s does not match recurring config schema:\n%s", name, strings.Join(messages, "\n"))
		})
	}
}

func mustParseYAML(t *testing.T, path string) map[string]any {
	t.Helper()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	value, err := koanfyaml.Parser().Unmarshal(raw)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return value
}

func mustOpenAPIToJSONSchema(t *testing.T, path string) map[string]any {
	t.Helper()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	doc, err := koanfyaml.Parser().Unmarshal(raw)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	schema := map[string]any{
		"$schema":    "https://json-schema.org/draft/2020-12/schema",
		"$ref":       "#/components/schemas/Config",
		"components": doc["components"],
	}
	return schema
}
