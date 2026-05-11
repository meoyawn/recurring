package apitest

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	configgen "github.com/recurring/api/internal/gen/config"
	"github.com/recurring/api/internal/serviceclient"
)

type childProcess struct {
	cmd  *exec.Cmd
	done chan error
}

func startSheets(ctx context.Context, socketPath string, telemetry configgen.TelemetryConfig) (*childProcess, error) {
	cmd := exec.CommandContext(ctx, "bun", "src/cmd.ts")
	cmd.Dir = filepath.Join("..", "..", "..", "sheets")
	cmd.Env = append(os.Environ(),
		"NODE_ENV=test",
		"RECURRING_SHEETS_LISTENER_KIND=unix",
		"RECURRING_SHEETS_SOCKET_PATH="+socketPath,
	)
	if telemetry.HasOtlpTracesEndpoint() {
		cmd.Env = append(cmd.Env, "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="+telemetry.GetOtlpTracesEndpoint())
	} else if telemetry.HasOtlpEndpoint() {
		cmd.Env = append(cmd.Env, "OTEL_EXPORTER_OTLP_ENDPOINT="+telemetry.GetOtlpEndpoint())
	}
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

func waitForSheets(ctx context.Context, socketPath string, sheets *childProcess) error {
	httpClient := serviceclient.NewHTTPClient(serviceclient.Config{
		UnixSocketPath: socketPath,
		Timeout:        time.Second,
		MaxAttempts:    1,
	})
	deadline := time.NewTimer(20 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case err := <-sheets.done:
			return fmt.Errorf("sheets exited before readiness: %w", err)
		case <-deadline.C:
			return errors.New("wait for sheets /healthz: timeout")
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := getHealthz(ctx, "http://recurring-sheets/healthz", httpClient); err == nil {
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
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %s", resp.Status)
	}
	return nil
}

func stopChild(ctx context.Context, child *childProcess) error {
	if child == nil || child.cmd.Process == nil {
		return nil
	}
	select {
	case err := <-child.done:
		return err
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

func randomSocketPath(dir string) (string, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("read socket path entropy: %w", err)
	}
	return filepath.Join(dir, "sheets-"+hex.EncodeToString(bytes[:])+".sock"), nil
}
