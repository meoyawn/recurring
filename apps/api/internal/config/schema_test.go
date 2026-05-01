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

func TestDevConfigMatchesSchema(t *testing.T) {
	schemaJSON := mustYAMLFileToJSON(t, filepath.Join("..", "..", "config", "schema.yaml"))
	devJSON := mustYAMLFileToJSON(t, filepath.Join("..", "..", "config", "dev.yaml"))

	result, err := gojsonschema.Validate(gojsonschema.NewBytesLoader(schemaJSON), gojsonschema.NewBytesLoader(devJSON))
	if err != nil {
		t.Fatalf("validate dev config against schema: %v", err)
	}
	if result.Valid() {
		return
	}

	var messages []string
	for _, desc := range result.Errors() {
		messages = append(messages, desc.String())
	}
	t.Fatalf("config/dev.yaml does not match config/schema.yaml:\n%s", strings.Join(messages, "\n"))
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
