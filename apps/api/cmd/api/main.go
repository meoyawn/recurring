package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/recurring/api/internal/app"
)

const exitFailure = 1

// release is replaced by the Go linker in release builds.
//
// The build task passes:
//
//	-ldflags "-X main.release=<release>"
//
// Go's linker flag "-X importpath.name=value" sets the value of a string
// variable in the linked binary. This only works when the target variable is
// either uninitialized or initialized to a constant string expression, so keep
// this as a package-level string var with a literal default. Local `go run`
// builds do not pass that linker flag, so they keep the "dev" fallback.
//
// See: https://pkg.go.dev/cmd/link#hdr-Command_Line
var release = "dev"

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(exitFailure)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	return app.Run(ctx, app.WithRelease(release))
}
