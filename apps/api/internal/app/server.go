package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/coreos/go-systemd/v22/activation"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/recurring/api/internal/config"
	database "github.com/recurring/api/internal/db"
	configgen "github.com/recurring/api/internal/gen/config"
	"github.com/recurring/api/internal/httpapi"
	"github.com/recurring/api/internal/migrator"
	"github.com/recurring/api/internal/telemetry"
)

type Server struct {
	httpServer *http.Server
	listener   net.Listener
	pool       *pgxpool.Pool
	traceStop  func(context.Context) error
	errc       chan error
}

func Start(ctx context.Context) (*Server, error) {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return nil, err
	}
	return StartWithConfig(ctx, cfg)
}

func StartWithConfig(ctx context.Context, cfg configgen.Config) (*Server, error) {
	traceStop, err := telemetry.Start(ctx, cfg.Telemetry)
	if err != nil {
		return nil, fmt.Errorf("start telemetry: %w", err)
	}

	pool, err := database.Open(ctx, cfg.Db)
	if err != nil {
		_ = traceStop(context.Background())
		return nil, err
	}

	if err := migrator.Up(ctx, pool); err != nil {
		pool.Close()
		_ = traceStop(context.Background())
		return nil, err
	}

	handler, err := httpapi.NewEcho(pool)
	if err != nil {
		pool.Close()
		_ = traceStop(context.Background())
		return nil, err
	}

	listener, err := listen(cfg.Api.Listener)
	if err != nil {
		pool.Close()
		_ = traceStop(context.Background())
		return nil, err
	}

	httpServer := &http.Server{Handler: handler}
	server := &Server{
		httpServer: httpServer,
		listener:   listener,
		pool:       pool,
		traceStop:  traceStop,
		errc:       make(chan error, 1),
	}
	go server.serve()
	return server, nil
}

func Run(ctx context.Context) error {
	server, err := Start(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = server.Close()
	}()

	select {
	case err := <-server.errc:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

func (s *Server) Addr() string {
	return s.listener.Addr().String()
}

func (s *Server) Shutdown(ctx context.Context) error {
	err := s.httpServer.Shutdown(ctx)
	s.pool.Close()
	if err != nil {
		return fmt.Errorf("shutdown http server: %w", err)
	}
	if serveErr, ok := <-s.errc; ok && serveErr != nil {
		return serveErr
	}
	if s.traceStop != nil {
		if err := s.traceStop(ctx); err != nil {
			return fmt.Errorf("shutdown telemetry: %w", err)
		}
	}
	return nil
}

func (s *Server) Close() error {
	if s.pool != nil {
		s.pool.Close()
	}
	if s.listener != nil {
		if err := s.listener.Close(); err != nil {
			return err
		}
	}
	if s.traceStop != nil {
		return s.traceStop(context.Background())
	}
	return nil
}

func (s *Server) serve() {
	err := s.httpServer.Serve(s.listener)
	if errors.Is(err, http.ErrServerClosed) {
		err = nil
	}
	s.errc <- err
	close(s.errc)
}

func listen(cfg configgen.ListenerConfig) (net.Listener, error) {
	switch cfg.Kind {
	case "tcp":
		addr := cfg.GetAddr()
		listener, err := net.Listen("tcp", addr)
		if err != nil {
			return nil, fmt.Errorf("listen tcp %q: %w", addr, err)
		}
		return listener, nil

	case "unix":
		path := cfg.GetPath()
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("remove stale unix socket %q: %w", path, err)
		}
		listener, err := net.Listen("unix", path)
		if err != nil {
			return nil, fmt.Errorf("listen unix %q: %w", path, err)
		}
		return listener, nil

	case "systemd":
		listeners, err := activation.Listeners()
		if err != nil {
			return nil, fmt.Errorf("load systemd listeners: %w", err)
		}
		if len(listeners) != 1 {
			return nil, fmt.Errorf("systemd listener count = %d, want 1", len(listeners))
		}
		return listeners[0], nil

	default:
		return nil, fmt.Errorf("unsupported listener kind %q", cfg.Kind)
	}
}
