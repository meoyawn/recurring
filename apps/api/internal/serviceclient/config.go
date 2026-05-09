package serviceclient

import (
	"time"

	"github.com/recurring/api/internal/config"
)

func FromServiceConfig(cfg config.ServiceConfig) Config {
	clientConfig := Config{
		Timeout:     time.Duration(cfg.TimeoutMS) * time.Millisecond,
		MaxAttempts: cfg.MaxAttempts,
	}
	if cfg.Transport.Kind == "unix" {
		clientConfig.UnixSocketPath = cfg.Transport.Path
	}
	return clientConfig
}
