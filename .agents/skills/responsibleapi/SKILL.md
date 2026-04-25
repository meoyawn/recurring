---
name: responsibleapi
description:
  Use when working on `*.responsible.ts` files or other TypeScript that declares
  APIs with the responsibleapi DSL. Covers `@responsibleapi/ts` route shape,
  schemas, params, responses, security, tags, and OpenAPI 3.1 authoring
  patterns.
---

# responsibleapi

Use this skill for `*.responsible.ts` files and other TypeScript that builds
OpenAPI with `@responsibleapi/ts`.

Target is OpenAPI `3.1+` only.

## Mental Model

`responsibleapi` is TypeScript DSL for declaring OpenAPI 3.1 APIs.

- Start with `responsibleAPI({ partialDoc, routes, ...defaults })`.
- `partialDoc` is raw OpenAPI 3.1 document shell. Keep `components` and
  top-level `security` out unless you know exact reason.
- `routes` is path map.
- Use method helpers like `GET(...)`, `POST(...)`, `PUT(...)`, `DELETE(...)`,
  `HEAD(...)` for single-method top-level paths.
- Use `scope({ ... })` when path has nested routes, shared params, shared
  security, or multiple methods.
- Inside `scope`, method keys are plain object keys like `GET: { ... }`,
  `POST: { ... }`. Do not use method helpers there.
- Paths use colon params: `"/users/:id"`.

## Minimal Example

```ts
import { GET, object, responsibleAPI, resp, string } from "@responsibleapi/ts"

export default responsibleAPI({
  partialDoc: {
    openapi: "3.1.0",
    info: {
      title: "Example API",
      version: "1.0.0",
    },
  },
  routes: {
    "/hello": GET({
      res: {
        200: resp({
          description: "OK",
          body: object({
            message: string(),
          }),
        }),
      },
    }),
  },
})
```

## Schema Basics

Prefer tiny schema thunks for reusable shapes:

```ts
const UserID = () => int64({ minimum: 1 })

const User = () =>
  object({
    id: UserID,
    name: string(),
    "nickname?": string(),
  })
```

Rules:

- Required object keys are plain keys.
- Optional object keys end with `?`.
- For reusable schemas, pass thunk itself, not `Thunk()`.
- Inline one-off schemas are fine when reuse does not matter.
- Use `named("ComponentName", value)` when schema/parameter/security/header
  needs stable component name.
- Use `ref(NamedValue, { description })` when you need `$ref` plus sibling
  metadata.
- Raw OpenAPI 3.1 schema objects are allowed when DSL has no helper. Keep them
  local, typed, and rare.

Common schema builders:

- `object`, `array`, `dict`
- `string`, `boolean`, `number`, `integer`
- `int32`, `int64`, `uint32`, `uint64`, `float`, `double`
- `unknown`, `nullable`, `oneOf`, `anyOf`, `allOf`
- `email`, `httpURL`, `unixMillis`

## Root Structure

```ts
responsibleAPI({
  partialDoc,
  security?,
  forEachOp?,
  forEachPath?,
  routes,
})
```

Use root defaults for cross-cutting behavior:

- `forEachOp` for shared operation defaults.
- `forEachPath` for shared path-level params.
- `security` for global auth requirements.

Typical `forEachOp` uses:

- `req.mime`
- `req.security`
- `res.mime`
- `res.defaults`
- `res.add`
- `tags`

Typical `forEachPath` use:

- `params`

## Routes And Scopes

Single top-level route:

```ts
"/users": GET({
  res: { 200: Users },
})
```

Top-level route with explicit operation id:

```ts
"/users": POST("createUser", {
  req: CreateUser,
  res: { 201: User },
})
```

Nested/shared path behavior:

```ts
"/users": scope({
  "/:id": scope({
    pathParams: {
      id: UserID,
    },
    GET: {
      res: { 200: User },
    },
    DELETE: {
      res: { 204: resp({ description: "Deleted" }) },
    },
  }),
})
```

Rules:

- Use method helpers only at top level.
- Use method keys only inside `scope`.
- Put shared `pathParams`, `params`, `forEachOp`, and `security` on nearest
  scope that owns them.

## Synthetic HEAD

`GET` operations can declare `headID` to pair with `HEAD`:

```ts
"/feed": GET({
  id: "getFeed",
  headID: "headFeed",
  res: { 200: Feed },
})
```

Rules:

- `headID` belongs on `GET`.
- Use `headID` when `GET` and `HEAD` should stay aligned.
- Use explicit `HEAD` when headers, statuses, or other behavior must diverge.

## Request Shape

For non-`GET` operations, request body shorthand is allowed:

```ts
req: CreateUser
```

Expanded request forms:

```ts
req: {
  body: CreateUser,
}

req: {
  "body?": CreateUser,
}
```

Inline params:

- `req.query`
- `req.headers`
- `req.pathParams`

Rules:

- Optional query/header keys end with `?`.
- Path params cannot be optional.
- Path params can live on operation, scope, or `forEachPath`.

Reusable params:

- `named("cursor", queryParam(...))`
- `named("userID", pathParam(...))`
- `named("requestID", headerParam(...))`

Then reuse with:

- `req.params`
- `forEachPath.params`

## Response Shape

Responses are status maps:

```ts
res: {
  200: User,
  404: resp({ description: "Not found" }),
}
```

Detailed response:

```ts
res: {
  200: resp({
    description: "OK",
    body: {
      "application/json": User,
    },
    headers: {
      "x-request-id": string(),
    },
  }),
}
```

Rules:

- Response `body` can be schema or MIME map.
- Use `res.defaults` for shared headers/mime across status ranges like
  `"100..599"`.
- Use `res.add` for default statuses inherited by many operations.
- One-off response headers go in `headers`.
- Reusable response headers use `named("header", responseHeader(...))` and
  `headerParams`.
- `cookies` models `Set-Cookie` response cookies.

## Parameters

Three main patterns:

1. Inline, local:

```ts
req: {
  query: {
    "cursor?": string(),
  },
}
```

2. Shared at path/scope level:

```ts
forEachPath: {
  params: [CursorParam],
}
```

3. Path segment ownership:

```ts
pathParams: {
  id: UserID,
}
```

Use nearest shared level that keeps intent obvious.

## Security

Security helpers:

- `headerSecurity`
- `querySecurity`
- `httpSecurity`
- `oauth2Security`
- `oauth2Requirement`
- `securityAND`
- `securityOR`

Rules:

- Name security schemes when they need stable component identity.
- `security` means authenticated request required.
- `"security?"` means operation may be authenticated or anonymous.
- Put shared auth on scope or `forEachOp` when most operations need it.

## Tags

Prefer declared tags:

```ts
const tags = declareTags({
  Users: {},
  Admin: {},
} as const)
```

Then:

- put `Object.values(tags)` into `partialDoc.tags`
- use `tags: [tags.Users]` on operations

## What Good Files Look Like

Good `*.responsible.ts` files usually:

- keep schemas tiny and composable
- move repeated defaults into `forEachOp` or nearest `scope`
- name reusable components once
- keep raw OpenAPI escape hatches small and local
- model params where path ownership is obvious
- stay OpenAPI 3.1-native

## Public Examples

Use these as source-of-truth patterns:

- [`http-benchmark.ts`](https://raw.githubusercontent.com/responsibleapi/ts/master/src/examples/http-benchmark.ts):
  compact request/response defaults, schema thunks
- [`exceptions.ts`](https://raw.githubusercontent.com/responsibleapi/ts/master/src/examples/exceptions.ts):
  scoped path params, inherited JSON defaults
- [`listenbox.ts`](https://raw.githubusercontent.com/responsibleapi/ts/master/src/examples/listenbox.ts):
  nested scopes, optional security, cookies, `HEAD`
- [`youtube.ts`](https://raw.githubusercontent.com/responsibleapi/ts/master/src/examples/youtube.ts):
  `forEachPath.params`, OAuth2 requirements, large named schema graph
- [`pachca.ts`](https://raw.githubusercontent.com/responsibleapi/ts/master/src/examples/pachca.ts):
  large API surface, inline params, raw OpenAPI 3.1 escape hatches
