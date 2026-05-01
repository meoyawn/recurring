package config

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"

	"github.com/knadh/koanf/parsers/yaml"
	"github.com/knadh/koanf/providers/confmap"
	"github.com/knadh/koanf/providers/file"
	"github.com/knadh/koanf/v2"
)

const EnvPath = "RECURRING_CONFIG"

type Config struct {
	API APIConfig `koanf:"api" yaml:"api" json:"api"`
	DB  DBConfig  `koanf:"db" yaml:"db" json:"db"`
}

type APIConfig struct {
	Listener ListenerConfig `koanf:"listener" yaml:"listener" json:"listener"`
}

type ListenerConfig struct {
	Kind string `koanf:"kind" yaml:"kind" json:"kind"`
	Addr string `koanf:"addr" yaml:"addr,omitempty" json:"addr,omitempty"`
	Path string `koanf:"path" yaml:"path,omitempty" json:"path,omitempty"`
}

type DBConfig struct {
	Host     string `koanf:"host" yaml:"host" json:"host"`
	Port     int    `koanf:"port" yaml:"port" json:"port"`
	Name     string `koanf:"name" yaml:"name" json:"name"`
	User     string `koanf:"user" yaml:"user" json:"user"`
	Password string `koanf:"password" yaml:"password" json:"password"`
	SSLMode  string `koanf:"sslmode" yaml:"sslmode" json:"sslmode"`
	MaxConns int32  `koanf:"max_conns" yaml:"max_conns" json:"max_conns"`
}

func LoadFromEnv() (Config, error) {
	path := os.Getenv(EnvPath)
	if path == "" {
		return Config{}, fmt.Errorf("%s is required", EnvPath)
	}
	return Load(path)
}

func Load(path string) (Config, error) {
	if path == "" {
		return Config{}, errors.New("config path is required")
	}

	k := koanf.New(".")
	if err := k.Load(confmap.Provider(defaults(), "."), nil); err != nil {
		return Config{}, fmt.Errorf("load config defaults: %w", err)
	}
	if err := k.Load(file.Provider(path), yaml.Parser()); err != nil {
		return Config{}, fmt.Errorf("load config file %q: %w", path, err)
	}

	var cfg Config
	if err := k.Unmarshal("", &cfg); err != nil {
		return Config{}, fmt.Errorf("unmarshal config %q: %w", path, err)
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, fmt.Errorf("validate config %q: %w", path, err)
	}
	return cfg, nil
}

func defaults() map[string]any {
	return map[string]any{
		"api.listener.kind": "tcp",
		"api.listener.addr": ":8080",
		"db.sslmode":        "disable",
		"db.max_conns":      int32(4),
	}
}

func (c Config) Validate() error {
	var errs []error
	add := func(format string, args ...any) {
		errs = append(errs, fmt.Errorf(format, args...))
	}

	switch c.API.Listener.Kind {
	case "tcp":
		if c.API.Listener.Addr == "" {
			add("api.listener.addr is required for tcp listener")
		}
	case "unix":
		if c.API.Listener.Path == "" {
			add("api.listener.path is required for unix listener")
		}
	case "systemd":
	default:
		add("api.listener.kind must be tcp, unix, or systemd")
	}

	if c.DB.Host == "" {
		add("db.host is required")
	}
	if c.DB.Port < 1 || c.DB.Port > 65535 {
		add("db.port must be between 1 and 65535")
	}
	if c.DB.Name == "" {
		add("db.name is required")
	}
	if c.DB.User == "" {
		add("db.user is required")
	}
	if c.DB.Password == "" {
		add("db.password is required")
	}
	if !validSSLMode(c.DB.SSLMode) {
		add("db.sslmode must be one of disable, allow, prefer, require, verify-ca, or verify-full")
	}
	if c.DB.MaxConns < 1 {
		add("db.max_conns must be greater than 0")
	}

	return errors.Join(errs...)
}

func validSSLMode(mode string) bool {
	switch mode {
	case "disable", "allow", "prefer", "require", "verify-ca", "verify-full":
		return true
	default:
		return false
	}
}

func (d DBConfig) ConnectionString(applicationName string) string {
	values := url.Values{}
	values.Set("sslmode", d.SSLMode)
	if applicationName != "" {
		values.Set("application_name", applicationName)
	}

	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(d.User, d.Password),
		Host:     net.JoinHostPort(d.Host, strconv.Itoa(d.Port)),
		Path:     "/" + d.Name,
		RawQuery: values.Encode(),
	}
	return u.String()
}
