package main

import (
	"log"
	"net/http"
	"os"

	"github.com/recurring/api/internal/httpapi"
)

func main() {
	addr := ":8080"
	if v := os.Getenv("RECURRING_API_ADDR"); v != "" {
		addr = v
	}
	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, httpapi.NewMux()); err != nil {
		log.Fatal(err)
	}
}
