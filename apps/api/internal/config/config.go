package config

import (
	"errors"
	"fmt"
	"os"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/providers/structs"
	"github.com/knadh/koanf/v2"
	configgen "github.com/recurring/api/internal/gen/config"
)

const EnvPath = "RECURRING_CONFIG"

const (
	defaultDBMaxConns      = int32(4)
	defaultSheetsTimeoutMS = 30000
	defaultSheetsAttempts  = 3
)

func LoadFromEnv() (configgen.Config, error) {
	path := os.Getenv(EnvPath)
	if path == "" {
		return configgen.Config{}, fmt.Errorf("%s is required", EnvPath)
	}
	return Load(path)
}

func Load(path string) (configgen.Config, error) {
	if path == "" {
		return configgen.Config{}, errors.New("config path is required")
	}

	k := koanf.New(".")
	if err := k.Load(structs.Provider(defaults(), "json"), nil); err != nil {
		return configgen.Config{}, fmt.Errorf("load config defaults: %w", err)
	}
	if err := k.Load(file.Provider(path), yaml.Parser()); err != nil {
		return configgen.Config{}, fmt.Errorf("load config file %q: %w", path, err)
	}

	var cfg configgen.Config
	if err := k.UnmarshalWithConf("", &cfg, koanf.UnmarshalConf{Tag: "json"}); err != nil {
		return configgen.Config{}, fmt.Errorf("unmarshal config %q: %w", path, err)
	}
	return cfg, nil
}

func defaults() configgen.Config {
	addr := ":8080"

	return configgen.Config{
		Api: configgen.APIConfig{
			Listener: configgen.ListenerConfig{
				Kind: configgen.TCP,
				Addr: &addr,
			},
		},
		Db: configgen.DBConfig{
			Sslmode:  configgen.DISABLE,
			MaxConns: defaultDBMaxConns,
		},
		Sheets: configgen.ServiceConfig{
			TimeoutMs:   defaultSheetsTimeoutMS,
			MaxAttempts: defaultSheetsAttempts,
		},
	}
}
