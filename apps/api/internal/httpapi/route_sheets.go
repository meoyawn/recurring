package httpapi

import (
	"fmt"
	"net/http"
	"os"

	"github.com/labstack/echo/v5"
	sheetsgen "github.com/recurring/api/internal/gen/sheets"
	"github.com/recurring/api/internal/serviceclient"
)

func SheetsTest(deps *HandlerDeps) echo.HandlerFunc {
	return func(c *echo.Context) error {
		ctx := c.Request().Context()
		ctx = serviceclient.WithRetryable(ctx, true)
		ctx = serviceclient.WithIdempotencyKey(ctx, "sheets-test")

		file, resp, err := deps.sheetsClient.DefaultAPI.CreateWorkbookExport(ctx).
			WorkbookExportRequest(*sheetsgen.NewWorkbookExportRequest("sheets-test", "USD", []sheetsgen.ExportRow{})).
			Execute()
		if resp != nil && resp.Body != nil {
			defer func() {
				_ = resp.Body.Close()
			}()
		}
		if err != nil {
			return sheetsExportError(err)
		}
		if file != nil {
			defer func() {
				name := file.Name()
				_ = file.Close()
				_ = os.Remove(name)
			}()
		}
		if resp == nil || resp.StatusCode != http.StatusCreated {
			return sheetsExportError(fmt.Errorf("unexpected sheets response: %v", resp))
		}

		return c.NoContent(http.StatusNoContent)
	}
}

func sheetsExportError(err error) error {
	return echo.NewHTTPError(http.StatusBadGateway, "sheets export failed").Wrap(err)
}
