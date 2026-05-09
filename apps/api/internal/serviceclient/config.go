package serviceclient

import (
	"time"

	configgen "github.com/recurring/api/internal/gen/config"
)

func FromServiceConfig(cfg configgen.ServiceConfig) Config {
	clientConfig := Config{
		Timeout:     time.Duration(cfg.TimeoutMs) * time.Millisecond,
		MaxAttempts: int(cfg.MaxAttempts),
	}
	if cfg.Transport.Kind == "unix" {
		clientConfig.UnixSocketPath = cfg.Transport.GetPath()
	}
	return clientConfig
}
