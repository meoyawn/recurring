package serviceclient

import (
	"strings"

	configgen "github.com/recurring/api/internal/gen/config"
	"github.com/recurring/api/internal/gen/sheets"
)

func NewSheetsClient(cfg configgen.ServiceConfig) *sheets.APIClient {
	clientConfig := sheets.NewConfiguration()
	clientConfig.HTTPClient = NewHTTPClient(FromServiceConfig(cfg))
	clientConfig.Servers[0].URL = strings.TrimRight(cfg.Origin, "/")
	return sheets.NewAPIClient(clientConfig)
}
