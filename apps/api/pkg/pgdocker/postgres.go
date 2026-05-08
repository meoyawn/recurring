package pgdocker

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/ory/dockertest/v4"
)

const portID = "5432/tcp"

type Config struct {
	Database string
	User     string
	Password string
	SSLMode  string
}

type Container struct {
	pool     dockertest.ClosablePool
	resource dockertest.ClosableResource
	config   Config
	host     string
	port     int
}

func Start(ctx context.Context, cfg Config) (*Container, error) {
	cfg = cfg.withDefaults()

	pool, err := dockertest.NewPool(ctx, "", dockertest.WithMaxWait(2*time.Minute))
	if err != nil {
		return nil, fmt.Errorf("create docker pool: %w", err)
	}

	resource, err := pool.Run(ctx,
		"postgres",
		dockertest.WithTag("18-alpine"),
		dockertest.WithEnv([]string{
			"POSTGRES_DB=" + cfg.Database,
			"POSTGRES_USER=" + cfg.User,
			"POSTGRES_PASSWORD=" + cfg.Password,
		}),
		dockertest.WithoutReuse(),
	)
	if err != nil {
		_ = pool.Close(context.WithoutCancel(ctx))
		return nil, fmt.Errorf("start postgres container: %w", err)
	}

	host, port, err := hostPort(resource)
	if err != nil {
		_ = resource.Close(context.WithoutCancel(ctx))
		_ = pool.Close(context.WithoutCancel(ctx))
		return nil, err
	}

	container := &Container{
		pool:     pool,
		resource: resource,
		config:   cfg,
		host:     host,
		port:     port,
	}

	if err := container.wait(ctx); err != nil {
		_ = container.Close(context.WithoutCancel(ctx))
		return nil, err
	}
	return container, nil
}

func (c Config) withDefaults() Config {
	if c.Database == "" {
		c.Database = "postgres"
	}
	if c.User == "" {
		c.User = "postgres"
	}
	if c.Password == "" {
		c.Password = "postgres"
	}
	if c.SSLMode == "" {
		c.SSLMode = "disable"
	}
	return c
}

func (c *Container) Host() string {
	return c.host
}

func (c *Container) Port() int {
	return c.port
}

func (c *Container) ConnectionString(applicationName string) string {
	values := url.Values{}
	values.Set("sslmode", c.config.SSLMode)
	if applicationName != "" {
		values.Set("application_name", applicationName)
	}

	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(c.config.User, c.config.Password),
		Host:     net.JoinHostPort(c.host, strconv.Itoa(c.port)),
		Path:     "/" + c.config.Database,
		RawQuery: values.Encode(),
	}
	return u.String()
}

func (c *Container) Close(ctx context.Context) error {
	var errs []error
	if c.resource != nil {
		if err := c.resource.Close(ctx); err != nil {
			errs = append(errs, fmt.Errorf("close postgres container: %w", err))
		}
	}
	if c.pool != nil {
		if err := c.pool.Close(ctx); err != nil {
			errs = append(errs, fmt.Errorf("close docker pool: %w", err))
		}
	}
	return errors.Join(errs...)
}

func (c *Container) wait(ctx context.Context) error {
	return c.pool.Retry(ctx, 2*time.Minute, func() error {
		db, err := sql.Open("pgx", c.ConnectionString("recurring_postgres_test"))
		if err != nil {
			return err
		}
		defer func() {
			_ = db.Close()
		}()
		return db.PingContext(ctx)
	})
}

func hostPort(resource dockertest.ClosableResource) (string, int, error) {
	hostPort := resource.GetHostPort(portID)
	if hostPort == "" {
		return "", 0, fmt.Errorf("postgres container port %s is not published", portID)
	}
	host, portString, err := net.SplitHostPort(hostPort)
	if err != nil {
		return "", 0, fmt.Errorf("parse postgres host port %q: %w", hostPort, err)
	}
	port, err := strconv.Atoi(portString)
	if err != nil {
		return "", 0, fmt.Errorf("parse postgres port %q: %w", portString, err)
	}
	return host, port, nil
}
