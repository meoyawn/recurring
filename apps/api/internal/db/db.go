package db

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strconv"

	"github.com/exaring/otelpgx"
	"github.com/jackc/pgx/v5/pgxpool"
	configgen "github.com/recurring/api/internal/gen/config"
)

func Open(ctx context.Context, cfg configgen.DBConfig) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(connectionString(cfg))
	if err != nil {
		return nil, fmt.Errorf("parse pool config: %w", err)
	}
	poolConfig.ConnConfig.Tracer = otelpgx.NewTracer()
	poolConfig.MaxConns = cfg.MaxConns

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("open pgx pool: %w", err)
	}
	return pool, nil
}

func connectionString(d configgen.DBConfig) string {
	values := url.Values{}
	values.Set("sslmode", string(d.Sslmode))

	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(d.User, d.Password),
		Host:     net.JoinHostPort(d.Host, strconv.Itoa(int(d.Port))),
		Path:     "/" + d.Name,
		RawQuery: values.Encode(),
	}
	return u.String()
}
