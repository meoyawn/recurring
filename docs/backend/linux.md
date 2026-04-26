# Linux Runtime Decision

Decision: run the Go API as a systemd service activated by a systemd Unix
domain socket. Caddy sends HTTP requests to that socket.

## Context

The API binary is a normal Go HTTP server using Echo:

```text
apps/api/cmd/api
```

The public entrypoint should be Caddy. The API process should not bind a public
TCP port in production.

Production runtime should support:

- private local API transport between Caddy and the Go process
- systemd-managed process lifecycle
- zero-downtime restarts for short deploys
- startup migrations before serving requests
- graceful shutdown for in-flight requests
- simple rollback to the previous binary
- journal logs and normal systemd health inspection

## Decision

Use a systemd socket unit for the API listener:

```text
/run/recurring/api.sock
```

Use a paired systemd service unit for the API process:

```text
recurring-api.socket
recurring-api.service
```

Caddy reverse proxies to the Unix socket:

```caddyfile
reverse_proxy unix//run/recurring/api.sock
```

This combines two separate mechanisms:

- Unix domain socket transport gives Caddy a private local HTTP path to the API.
- systemd socket activation makes systemd own the listening socket and pass the
  open listener fd to the API process.

The performance and local-only transport property comes from the Unix domain
socket. The restart buffering property comes from socket activation: systemd
keeps the listener open while the service process is stopped or starting, so
new unaccepted stream connections can queue in the listener backlog.

## Echo Support

Echo supports this shape.

Echo is built on Go `net/http`. A Unix domain socket is just a `net.Listener`.
Systemd socket activation hands the process an already-open listener. The API
should pass that listener to Echo through the underlying HTTP server instead of
calling `e.Start(":8080")`.

Expected implementation shape:

```go
listeners, err := activation.Listeners()
if err != nil {
	return err
}
if len(listeners) != 1 {
	return fmt.Errorf("expected one systemd listener, got %d", len(listeners))
}

server := &http.Server{
	Handler: echoServer,
}

err = server.Serve(listeners[0])
```

Use `github.com/coreos/go-systemd/v22/activation` or equivalent small glue to
read systemd-provided listeners. Do not make the production path depend on TCP
`RECURRING_API_ADDR`.

Local development may keep a TCP fallback:

```text
RECURRING_API_ADDR=:8080
```

Production should prefer socket activation when `LISTEN_FDS` is present.

## Systemd Socket Unit

Suggested shape:

```ini
[Unit]
Description=Recurring API socket

[Socket]
ListenStream=/run/recurring/api.sock
SocketUser=recurring
SocketGroup=caddy
SocketMode=0660
DirectoryMode=0755
RemoveOnStop=true
Accept=no
FlushPending=no

[Install]
WantedBy=sockets.target
```

The socket group should match the Caddy service user or a shared group that
Caddy belongs to.

`Accept=no` is the default and is the desired mode for the API: systemd passes
the listening socket to one long-running Go process. `FlushPending=no` is also
the default and preserves pending socket buffers after the service exits, which
is the desired restart behavior. If queue depth needs tuning, set `Backlog=`
on the socket unit and keep in mind that Linux caps it with `net.core.somaxconn`.

## Systemd Service Unit

Suggested shape:

```ini
[Unit]
Description=Recurring API
Requires=recurring-api.socket
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=notify
User=recurring
Group=recurring
ExecStart=/opt/recurring/current/bin/recurring-api
EnvironmentFile=/etc/recurring/api.env
Restart=on-failure
RestartSec=2s
KillSignal=SIGTERM
TimeoutStopSec=30s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/run/recurring

[Install]
WantedBy=multi-user.target
```

`Type=notify` is preferred once the API sends `READY=1` after migrations,
database pool startup, route registration, and listener startup are complete.
Until then, `Type=simple` is acceptable.

The socket unit owns the runtime socket path. Do not also make the service own
`RuntimeDirectory=recurring`, because stopping the service must not remove the
directory while the socket unit is still active.

## Startup Order

Startup sequence:

1. systemd owns `/run/recurring/api.sock`.
2. Caddy may start before the API process.
3. First request or explicit service start activates `recurring-api.service`.
4. API reads config.
5. API runs goose migrations through a short-lived `database/sql` connection.
6. API opens the long-lived `pgxpool.Pool`.
7. API builds Echo routes from OpenAPI operation IDs.
8. API serves the inherited systemd listener.
9. API sends systemd readiness notification when supported.

The process must not accept requests before migrations and DB startup complete.

## Caddy

Suggested Caddy route:

```caddyfile
example.com {
	encode zstd gzip

	handle /api/* {
		reverse_proxy unix//run/recurring/api.sock
	}

	handle {
		root * /var/www/recurring
		file_server
	}
}
```

Caddy talks HTTP over the Unix socket. TLS, public TCP listeners, compression,
and client-facing headers stay in Caddy.

The API should still enforce its own auth, request validation, and JSON error
handling. The Unix socket is a transport boundary, not a trust boundary for user
requests.

## Zero Downtime

Systemd socket activation improves restart behavior because systemd owns the
listening socket, not the API process.

During a restart:

1. systemd keeps the socket open.
2. old API receives `SIGTERM`.
3. old API stops accepting new requests and drains in-flight requests.
4. systemd starts the new API process.
5. new API inherits the same socket.
6. queued or new connections are served by the new process after it is ready.

API shutdown should use `http.Server.Shutdown(ctx)` or Echo's shutdown helper
with a bounded timeout. Handlers must use request contexts so pgx queries cancel
when clients disconnect or shutdown expires.

This is zero downtime for normal short restarts. It is not a replacement for:

- in-flight request draining
- backward-compatible database migrations
- graceful handler cancellation
- readiness checks
- deploy rollback
- avoiding long startup migrations

Socket activation buffers unaccepted connections at the listener. It does not
preserve requests that the old process has already accepted, and it does not
make unsafe migrations safe. Long startup work can still exhaust client
timeouts or the listener backlog.

## Migration Rules

Startup migrations remain allowed, but must follow the expand-only rules from
the Postgres plan.

For zero downtime:

- migrations must complete before the new process announces readiness
- the old binary must remain compatible with the expanded schema
- the new binary must remain compatible with the old schema until migration has
  completed successfully
- contract migrations must run later through an explicit ops step

Long migrations should move out of API startup and into a separate migration
unit or deploy step before the API restart.

## Deploy Pattern

Use a release directory with an atomic `current` symlink:

```text
/opt/recurring/releases/20260426120000/bin/recurring-api
/opt/recurring/current -> /opt/recurring/releases/20260426120000
```

Deploy sequence:

1. Upload new release directory.
2. Run binary smoke check.
3. Update `current` symlink.
4. Restart `recurring-api.service`.
5. Verify readiness and Caddy route.
6. Keep previous release for rollback.

Rollback sequence:

1. Point `current` at previous release.
2. Restart `recurring-api.service`.
3. Verify readiness.

Rollback is only safe when database migrations were expand-only and remain
compatible with the previous binary.

## Config

Production:

```text
DATABASE_URL=postgres://recurring:recurring@127.0.0.1:5432/recurring?sslmode=disable
RECURRING_API_LISTEN=systemd
```

Local fallback:

```text
DATABASE_URL=postgres://recurring:recurring@127.0.0.1:5432/recurring?sslmode=disable
RECURRING_API_ADDR=:8080
```

Do not expose `RECURRING_API_ADDR` on public interfaces in production.

## File Layout

Expected ops files:

```text
ops/ansible/systemd/recurring-api.socket
ops/ansible/systemd/recurring-api.service
ops/ansible/caddy/Caddyfile
```

Expected API runtime package:

```text
apps/api/internal/listener/
```

`internal/listener` should:

- detect systemd socket activation through `LISTEN_FDS`
- return the inherited listener in production
- provide a TCP listener fallback for local development
- return clear errors for missing or multiple production listeners

## Result

Run the API behind Caddy over a Unix domain socket.

Use systemd socket activation so restarts preserve the listener and allow short
deploys without dropping the public route.

Echo supports this because it can serve an inherited Unix socket listener through
Go `net/http`.
