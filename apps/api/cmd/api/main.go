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

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(exitFailure)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	return app.Run(ctx)
}
