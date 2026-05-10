package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/recurring/api/internal/app"
	"github.com/recurring/api/internal/config"
	configgen "github.com/recurring/api/internal/gen/config"
)

type childProcess struct {
	cmd  *exec.Cmd
	done chan error
}

func main() {
	os.Exit(run())
}

func run() int {
	configPath := flag.String("config", "config/dev.yaml", "API config path")
	cwd := flag.String("cwd", "", "wrapped command working directory")
	flag.Parse()

	command := flag.Args()
	if len(command) == 0 {
		fmt.Fprintln(os.Stderr, "wrapped command is required")
		return 2
	}

	ctx, stopSignals := signalContext()
	defer stopSignals()

	env, err := startEnvironment(ctx, *configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "start web test environment: %v\n", err)
		return 1
	}

	code := runCommand(ctx, command, *cwd, env.apiOrigin)
	if err := env.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "stop web test environment: %v\n", err)
		return 1
	}
	return code
}

func signalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
}

type testEnvironment struct {
	api       *app.Server
	apiOrigin string
	sheets    *childProcess
}

func startEnvironment(ctx context.Context, configPath string) (*testEnvironment, error) {
	cfg, err := config.Load(configPath)
	if err != nil {
		return nil, err
	}

	sheetsPort, err := freePort()
	if err != nil {
		return nil, err
	}
	sheetsOrigin := fmt.Sprintf("http://127.0.0.1:%d", sheetsPort)
	sheets, err := startSheets(ctx, sheetsPort)
	if err != nil {
		return nil, err
	}
	if err := waitForHealthz(ctx, sheetsOrigin+"/healthz", sheets); err != nil {
		_ = stopChild(context.Background(), sheets)
		return nil, err
	}

	api, err := startAPI(ctx, cfg, sheetsOrigin)
	if err != nil {
		_ = stopChild(context.Background(), sheets)
		return nil, fmt.Errorf("start api: %w", err)
	}
	apiOrigin := "http://" + api.Addr()
	if err := waitForHealthz(ctx, apiOrigin+"/healthz", nil); err != nil {
		_ = api.Close()
		_ = stopChild(context.Background(), sheets)
		return nil, err
	}

	return &testEnvironment{api: api, apiOrigin: apiOrigin, sheets: sheets}, nil
}

func startSheets(ctx context.Context, port int) (*childProcess, error) {
	cmd := exec.CommandContext(ctx, "bun", "src/cmd.ts")
	cmd.Dir = filepath.Join("..", "sheets")
	cmd.Env = append(os.Environ(),
		"NODE_ENV=test",
		"RECURRING_SHEETS_LISTENER_KIND=tcp",
		"RECURRING_SHEETS_HOST=127.0.0.1",
		fmt.Sprintf("RECURRING_SHEETS_PORT=%d", port),
	)
	if err := pipeCommand(cmd, "sheets"); err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start sheets: %w", err)
	}
	child := &childProcess{cmd: cmd, done: make(chan error, 1)}
	go func() {
		child.done <- cmd.Wait()
	}()
	return child, nil
}

func startAPI(ctx context.Context, devConfig configgen.Config, sheetsOrigin string) (*app.Server, error) {
	cfg := devConfig
	cfg.Api.Listener = configgen.ListenerConfig{Kind: "tcp"}
	cfg.Api.Listener.SetAddr("127.0.0.1:0")
	cfg.Sheets.Origin = sheetsOrigin
	cfg.Sheets.Transport = configgen.TransportConfig{Kind: "tcp"}

	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	var lastErr error
	for {
		server, err := app.StartWithConfig(ctx, cfg)
		if err == nil {
			return server, nil
		}
		lastErr = err

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-deadline.C:
			return nil, lastErr
		case <-ticker.C:
		}
	}
}

func runCommand(ctx context.Context, command []string, cwd string, apiOrigin string) int {
	cmd := exec.CommandContext(ctx, command[0], command[1:]...)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), "RECURRING_API_ORIGIN="+apiOrigin)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin

	if err := cmd.Run(); err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return exitErr.ExitCode()
		}
		fmt.Fprintf(os.Stderr, "run wrapped command: %v\n", err)
		return 1
	}
	return 0
}

func (env *testEnvironment) Close() error {
	var errs []error

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := env.api.Shutdown(shutdownCtx); err != nil {
		errs = append(errs, fmt.Errorf("shutdown api: %w", err))
	}
	shutdownCancel()

	if err := stopChild(context.Background(), env.sheets); err != nil {
		errs = append(errs, fmt.Errorf("stop sheets: %w", err))
	}

	if len(errs) == 0 {
		return nil
	}
	return errors.Join(errs...)
}

func freePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("reserve tcp port: %w", err)
	}
	defer func() {
		_ = listener.Close()
	}()
	tcpAddr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("reserved non-tcp address %s", listener.Addr())
	}
	return tcpAddr.Port, nil
}

func waitForHealthz(ctx context.Context, url string, child *childProcess) error {
	client := http.Client{Timeout: time.Second}
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-deadline.C:
			return fmt.Errorf("wait for %s: timeout", url)
		case <-ticker.C:
			if child != nil {
				select {
				case err := <-child.done:
					return fmt.Errorf("process exited before readiness: %w", err)
				default:
				}
			}
			if err := getHealthz(ctx, url, &client); err == nil {
				return nil
			}
		}
	}
}

func getHealthz(ctx context.Context, url string, client *http.Client) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("status %s", resp.Status)
	}
	return nil
}

func stopChild(ctx context.Context, child *childProcess) error {
	if child == nil || child.cmd.Process == nil {
		return nil
	}
	select {
	case <-child.done:
		return nil
	default:
	}
	if err := child.cmd.Process.Signal(syscall.SIGTERM); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return err
	}
	select {
	case <-child.done:
		return nil
	case <-time.After(5 * time.Second):
		if err := child.cmd.Process.Kill(); err != nil && !errors.Is(err, os.ErrProcessDone) {
			return err
		}
		select {
		case <-child.done:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	case <-ctx.Done():
		return ctx.Err()
	}
}

func pipeCommand(cmd *exec.Cmd, prefix string) error {
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("open stderr pipe: %w", err)
	}
	go pipeLines(os.Stdout, prefix, stdout)
	go pipeLines(os.Stderr, prefix, stderr)
	return nil
}

func pipeLines(out io.Writer, prefix string, input io.Reader) {
	scanner := bufio.NewScanner(input)
	for scanner.Scan() {
		_, _ = fmt.Fprintf(out, "[%s] %s\n", prefix, scanner.Text())
	}
}
