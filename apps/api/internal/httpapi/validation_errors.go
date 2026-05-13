package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/labstack/echo/v5"
	"github.com/recurring/api/internal/gen/openapi"
)

const (
	validationCodeInvalid  = "invalid"
	validationCodeParse    = "parse"
	validationCodeRequired = "required"
	validationFailed       = "Validation failed"
	validationLocationBody = openapi.BODY
)

func validationErrorHandler(c *echo.Context, err *echo.HTTPError) error {
	if err.Code != http.StatusBadRequest {
		return err
	}

	issues := validationIssues(err)
	if len(issues) == 0 {
		return err
	}

	return c.JSON(http.StatusBadRequest, openapi.ValidationErr{
		Message: validationFailed,
		Errors:  issues,
	})
}

func validationIssues(err error) []openapi.ValidationIssue {
	if err == nil {
		return nil
	}

	multiErr, ok := err.(openapi3.MultiError) //nolint:errorlint // Direct MultiError preserves all sibling issues.
	if ok {
		return validationIssuesFromMultiError(multiErr)
	}

	var httpErr *echo.HTTPError
	if errors.As(err, &httpErr) {
		if unwrapped := httpErr.Unwrap(); unwrapped != nil {
			return validationIssues(unwrapped)
		}
		return nil
	}

	var requestErr *openapi3filter.RequestError
	if errors.As(err, &requestErr) {
		return validationIssuesFromRequestError(requestErr)
	}

	var schemaErr *openapi3.SchemaError
	if errors.As(err, &schemaErr) {
		return []openapi.ValidationIssue{newSchemaValidationIssue(validationLocationBody, nil, schemaErr)}
	}

	var parseErr *openapi3filter.ParseError
	if errors.As(err, &parseErr) {
		return []openapi.ValidationIssue{newParseValidationIssue(validationLocationBody, nil, parseErr)}
	}

	return []openapi.ValidationIssue{
		newGenericValidationIssue(validationLocationBody, nil, validationCodeInvalid, err.Error()),
	}
}

func validationIssuesFromMultiError(multiErr openapi3.MultiError) []openapi.ValidationIssue {
	issues := make([]openapi.ValidationIssue, 0, len(multiErr))
	for _, err := range multiErr {
		issues = append(issues, validationIssues(err)...)
	}
	return issues
}

func validationIssuesFromRequestError(err *openapi3filter.RequestError) []openapi.ValidationIssue {
	location, fallbackPath := validationRequestLocation(err)
	if err.Err != nil {
		issues := validationIssuesFromNested(err.Err, location, fallbackPath)
		if len(issues) > 0 {
			return issues
		}
	}

	code := validationCodeInvalid
	if errors.Is(err.Err, openapi3filter.ErrInvalidRequired) {
		code = validationCodeRequired
	}
	return []openapi.ValidationIssue{newGenericValidationIssue(location, fallbackPath, code, err.Error())}
}

func validationIssuesFromNested(
	err error,
	location openapi.ValidationLocation,
	fallbackPath []string,
) []openapi.ValidationIssue {
	if err == nil {
		return nil
	}

	multiErr, ok := err.(openapi3.MultiError) //nolint:errorlint // Direct MultiError preserves all sibling issues.
	if ok {
		issues := make([]openapi.ValidationIssue, 0, len(multiErr))
		for _, err := range multiErr {
			issues = append(issues, validationIssuesFromNested(err, location, fallbackPath)...)
		}
		return issues
	}

	var schemaErr *openapi3.SchemaError
	if errors.As(err, &schemaErr) {
		return []openapi.ValidationIssue{newSchemaValidationIssue(location, fallbackPath, schemaErr)}
	}

	var parseErr *openapi3filter.ParseError
	if errors.As(err, &parseErr) {
		return []openapi.ValidationIssue{newParseValidationIssue(location, fallbackPath, parseErr)}
	}

	code := validationCodeInvalid
	if errors.Is(err, openapi3filter.ErrInvalidRequired) {
		code = validationCodeRequired
	}
	return []openapi.ValidationIssue{newGenericValidationIssue(location, fallbackPath, code, err.Error())}
}

func validationRequestLocation(err *openapi3filter.RequestError) (openapi.ValidationLocation, []string) {
	if err.Parameter != nil {
		return openapi.ValidationLocation(err.Parameter.In), []string{err.Parameter.Name}
	}
	return validationLocationBody, nil
}

func newSchemaValidationIssue(
	location openapi.ValidationLocation,
	fallbackPath []string,
	err *openapi3.SchemaError,
) openapi.ValidationIssue {
	path := err.JSONPointer()
	if len(path) == 0 {
		path = fallbackPath
	}
	return newGenericValidationIssue(location, path, schemaErrorCode(err), schemaErrorMessage(err))
}

func newParseValidationIssue(
	location openapi.ValidationLocation,
	fallbackPath []string,
	err *openapi3filter.ParseError,
) openapi.ValidationIssue {
	path := stringPath(err.Path())
	if len(path) == 0 {
		path = fallbackPath
	}
	return newGenericValidationIssue(location, path, validationCodeParse, err.Error())
}

func newGenericValidationIssue(
	location openapi.ValidationLocation,
	path []string,
	code string,
	message string,
) openapi.ValidationIssue {
	issue := openapi.ValidationIssue{
		In:      location,
		Code:    code,
		Message: message,
	}
	if field := validationField(path); field != "" {
		issue.Field = &field
		issue.Path = validationPath(path)
	}
	return issue
}

func schemaErrorCode(err *openapi3.SchemaError) string {
	switch err.SchemaField {
	case "":
		return validationCodeInvalid
	case "format":
		if err.Schema != nil && err.Schema.Format != "" {
			return "format." + err.Schema.Format
		}
		return "format"
	case "properties":
		return "additionalProperties"
	default:
		return err.SchemaField
	}
}

func schemaErrorMessage(err *openapi3.SchemaError) string {
	if err.Reason != "" {
		return err.Reason
	}
	return err.Error()
}

func stringPath(path []any) []string {
	if len(path) == 0 {
		return nil
	}

	result := make([]string, 0, len(path))
	for _, segment := range path {
		result = append(result, fmt.Sprint(segment))
	}
	return result
}

func validationPath(path []string) []string {
	if len(path) == 0 {
		return nil
	}
	return append([]string(nil), path...)
}

func validationField(path []string) string {
	return strings.Join(path, ".")
}
