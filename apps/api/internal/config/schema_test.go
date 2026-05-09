package config_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xeipuuv/gojsonschema"
	"gopkg.in/yaml.v3"
)

func TestConfigFilesMatchSchema(t *testing.T) {
	t.Parallel()

	schemaJSON := mustOpenAPIConfigSchemaToJSON(t, filepath.Join("..", "..", "config", "schema.openapi.yaml"))
	for _, name := range []string{"dev.yaml", "test.yaml"} {
		name := name
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			configJSON := mustYAMLFileToJSON(t, filepath.Join("..", "..", "config", name))
			result, err := gojsonschema.Validate(gojsonschema.NewBytesLoader(schemaJSON), gojsonschema.NewBytesLoader(configJSON))
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

func mustYAMLFileToJSON(t *testing.T, path string) []byte {
	t.Helper()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	out, err := yamlToJSON(raw)
	if err != nil {
		t.Fatalf("convert %s to json: %v", path, err)
	}
	return out
}

func mustOpenAPIConfigSchemaToJSON(t *testing.T, path string) []byte {
	t.Helper()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var doc map[string]any
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	schema := map[string]any{
		"$schema": "https://json-schema.org/draft/2020-12/schema",
		"$ref":    "#/components/schemas/Config",
		"components": doc["components"],
	}
	out, err := json.Marshal(jsonCompatible(schema))
	if err != nil {
		t.Fatalf("convert %s to json schema: %v", path, err)
	}
	return out
}

func yamlToJSON(raw []byte) ([]byte, error) {
	var value any
	if err := yaml.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return json.Marshal(jsonCompatible(value))
}

func jsonCompatible(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		out := map[string]any{}
		for key, val := range typed {
			out[key] = jsonCompatible(val)
		}
		return out
	case map[any]any:
		out := map[string]any{}
		for key, val := range typed {
			out[fmt.Sprint(key)] = jsonCompatible(val)
		}
		return out
	case []any:
		out := make([]any, len(typed))
		for i, val := range typed {
			out[i] = jsonCompatible(val)
		}
		return out
	default:
		return typed
	}
}
