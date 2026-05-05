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
	"github.com/recurring/api/internal/httpapi"
	"github.com/recurring/api/internal/migrator"
)

type Server struct {
	httpServer *http.Server
	listener   net.Listener
	pool       *pgxpool.Pool
	errc       chan error
}

func Start(ctx context.Context) (*Server, error) {
	cfg, err := config.LoadFromEnv()
	if err != nil {
		return nil, err
	}
	return StartWithConfig(ctx, cfg)
}

func StartWithConfig(ctx context.Context, cfg config.Config) (*Server, error) {
	if err := migrator.Up(ctx, cfg.DB.ConnectionString("recurring_migration")); err != nil {
		return nil, err
	}

	pool, err := database.Open(ctx, cfg.DB)
	if err != nil {
		return nil, err
	}

	handler, err := httpapi.NewEcho(pool)
	if err != nil {
		pool.Close()
		return nil, err
	}

	listener, err := listen(cfg.API.Listener)
	if err != nil {
		pool.Close()
		return nil, err
	}

	httpServer := &http.Server{Handler: handler}
	server := &Server{
		httpServer: httpServer,
		listener:   listener,
		pool:       pool,
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
	defer server.Close()

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
	return nil
}

func (s *Server) Close() error {
	if s.pool != nil {
		s.pool.Close()
	}
	if s.listener != nil {
		return s.listener.Close()
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

func listen(cfg config.ListenerConfig) (net.Listener, error) {
	switch cfg.Kind {
	case "tcp":
		listener, err := net.Listen("tcp", cfg.Addr)
		if err != nil {
			return nil, fmt.Errorf("listen tcp %q: %w", cfg.Addr, err)
		}
		return listener, nil

	case "unix":
		if err := os.Remove(cfg.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("remove stale unix socket %q: %w", cfg.Path, err)
		}
		listener, err := net.Listen("unix", cfg.Path)
		if err != nil {
			return nil, fmt.Errorf("listen unix %q: %w", cfg.Path, err)
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
