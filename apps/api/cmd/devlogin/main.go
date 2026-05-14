package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"html"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/recurring/api/internal/config"
	database "github.com/recurring/api/internal/db"
	"github.com/recurring/api/internal/gen/pggen"
)

const (
	exitConfigError     = 2
	exitFailure         = 1
	sessionCookieName   = "sessionID"
	sessionCookiePath   = "/"
	sessionCookieMaxAge = 60 * 60 * 24 * 30
	renderedPath        = "/rendered"
	serverReadTimeout   = 10 * time.Second
	serverCloseTimeout  = 10 * time.Second
	defaultWaitTimeout  = 2 * time.Minute
	cookieListenPort    = "0"
	randomTokenBytes    = 12
	nameTokenPrefixLen  = 8
)

func main() {
	os.Exit(run())
}

func run() int {
	configPath := flag.String("config", "config/dev.yaml", "API config path")
	wranglerPath := flag.String("wrangler", "../inertia/wrangler.toml", "Wrangler config path")
	wranglerEnv := flag.String("wrangler-env", "development", "Wrangler environment name")
	waitTimeout := flag.Duration("timeout", defaultWaitTimeout, "time to wait for browser render")
	flag.Parse()

	ctx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load config: %v\n", err)
		return exitConfigError
	}
	webOrigin, err := loadWebOrigin(*wranglerPath, *wranglerEnv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "load web origin: %v\n", err)
		return exitConfigError
	}

	pool, err := database.Open(ctx, cfg.Db)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open db: %v\n", err)
		return exitFailure
	}
	defer pool.Close()

	params, err := randomSignupParams()
	if err != nil {
		fmt.Fprintf(os.Stderr, "build random signup params: %v\n", err)
		return exitFailure
	}
	sessionID, err := pggen.NewQuerier(pool).CreateSignupSession(ctx, params)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create signup session: %v\n", err)
		return exitFailure
	}

	if err := openCookieServer(ctx, webOrigin, sessionID, params.Email, *waitTimeout); err != nil {
		fmt.Fprintf(os.Stderr, "complete browser login: %v\n", err)
		return exitFailure
	}
	fmt.Fprintf(os.Stdout, "created %s session for %s\n", webOrigin, params.Email)
	return 0
}

type wranglerConfig struct {
	Env map[string]wranglerEnv `toml:"env"`
}

type wranglerEnv struct {
	Vars wranglerVars `toml:"vars"`
}

type wranglerVars struct {
	RecurringWebOrigin string `toml:"RECURRING_WEB_ORIGIN"`
}

func loadWebOrigin(path string, env string) (*url.URL, error) {
	var cfg wranglerConfig
	if _, err := toml.DecodeFile(path, &cfg); err != nil {
		return nil, fmt.Errorf("decode %q: %w", path, err)
	}
	envCfg, ok := cfg.Env[env]
	if !ok {
		return nil, fmt.Errorf("missing env.%s", env)
	}
	if envCfg.Vars.RecurringWebOrigin == "" {
		return nil, fmt.Errorf("missing env.%s.vars.RECURRING_WEB_ORIGIN", env)
	}

	origin, err := url.Parse(envCfg.Vars.RecurringWebOrigin)
	if err != nil {
		return nil, fmt.Errorf("parse RECURRING_WEB_ORIGIN: %w", err)
	}
	if origin.Scheme != "http" {
		return nil, fmt.Errorf("unsupported RECURRING_WEB_ORIGIN scheme %q", origin.Scheme)
	}
	if origin.Host == "" {
		return nil, errors.New("RECURRING_WEB_ORIGIN host is required")
	}
	return origin, nil
}

func randomSignupParams() (pggen.CreateSignupSessionParams, error) {
	token, err := randomHex(randomTokenBytes)
	if err != nil {
		return pggen.CreateSignupSessionParams{}, err
	}
	return pggen.CreateSignupSessionParams{
		GoogleSub:  "dev-" + token,
		Email:      "dev-" + token + "@recurring.localhost",
		Name:       "Dev User " + token[:nameTokenPrefixLen],
		PictureURL: "https://example.invalid/recurring-dev-login/" + token + ".png",
	}, nil
}

func randomHex(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func openCookieServer(
	ctx context.Context,
	origin *url.URL,
	sessionID string,
	loginEmail string,
	waitTimeout time.Duration,
) error {
	listenAddr := originListenAddr(origin)
	listenConfig := net.ListenConfig{}
	listener, err := listenConfig.Listen(ctx, "tcp", listenAddr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", listenAddr, err)
	}
	cookieURL, err := cookieServerURL(origin, listener.Addr())
	if err != nil {
		_ = listener.Close()
		return err
	}

	rendered := make(chan struct{})
	server := &http.Server{
		Handler:           cookieServerHandler(origin, sessionID, loginEmail, rendered),
		ReadHeaderTimeout: serverReadTimeout,
	}
	done := make(chan error, 1)
	go func() {
		err := server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		done <- err
	}()

	printLoginURL(ctx, cookieURL.String())

	err = waitForBrowserRender(ctx, waitTimeout, rendered)
	shutdownErr := shutdownServer(context.WithoutCancel(ctx), server)
	serveErr := <-done
	return errors.Join(err, shutdownErr, serveErr)
}

func cookieServerHandler(
	origin *url.URL,
	sessionID string,
	loginEmail string,
	rendered chan struct{},
) http.Handler {
	var renderedOnce sync.Once
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == renderedPath {
			w.WriteHeader(http.StatusNoContent)
			renderedOnce.Do(func() {
				close(rendered)
			})
			return
		}

		w.Header().Set("Set-Cookie", sessionCookie(sessionID))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Dev login</title></head>
<body>
<p>logged in as %s</p>
<p><a href="%s">continue to app</a></p>
<script>
addEventListener("DOMContentLoaded", () => {
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			fetch("%s", { method: "POST", keepalive: true }).catch(() => {});
		});
	});
});
</script>
</body>
</html>
`, html.EscapeString(loginEmail), html.EscapeString(origin.String()), renderedPath)
	})
}

func originListenAddr(origin *url.URL) string {
	return net.JoinHostPort(origin.Hostname(), cookieListenPort)
}

func cookieServerURL(origin *url.URL, addr net.Addr) (*url.URL, error) {
	tcpAddr, ok := addr.(*net.TCPAddr)
	if !ok {
		return nil, fmt.Errorf("cookie listener addr %T is not TCP", addr)
	}

	return &url.URL{
		Scheme: origin.Scheme,
		Host:   net.JoinHostPort(origin.Hostname(), strconv.Itoa(tcpAddr.Port)),
	}, nil
}

func printLoginURL(ctx context.Context, target string) {
	if err := copyToClipboard(ctx, target); err != nil {
		fmt.Fprintf(os.Stdout, "open this URL in the Codex browser:\n%s\n", target)
		fmt.Fprintf(os.Stdout, "copy URL to clipboard: %v\n", err)
		return
	}
	fmt.Fprintf(os.Stdout, "copied URL to clipboard; open it in the Codex browser:\n%s\n", target)
}

func copyToClipboard(ctx context.Context, target string) error {
	cmd := exec.CommandContext(ctx, "pbcopy")
	cmd.Stdin = strings.NewReader(target)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("run pbcopy: %w", err)
	}
	return nil
}

func waitForBrowserRender(ctx context.Context, timeout time.Duration, rendered <-chan struct{}) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case <-rendered:
		return nil
	case <-timer.C:
		return fmt.Errorf("wait for browser render: timeout after %s", timeout)
	case <-ctx.Done():
		return ctx.Err()
	}
}

func shutdownServer(ctx context.Context, server *http.Server) error {
	shutdownCtx, cancel := context.WithTimeout(ctx, serverCloseTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown cookie server: %w", err)
	}
	return nil
}

func sessionCookie(sessionID string) string {
	return sessionCookieName + "=" + url.QueryEscape(sessionID) +
		"; Path=" + sessionCookiePath +
		"; HttpOnly" +
		"; SameSite=Lax" +
		"; Max-Age=" + strconv.Itoa(sessionCookieMaxAge)
}
