#!/usr/bin/env bun

import {
  int32,
  named,
  object,
  responsibleAPI,
  string,
} from "@responsibleapi/ts"
import { YAML } from "bun"

const NonEmptyString = () => string({ minLength: 1 })

const ListenerKind = () =>
  string({
    enum: ["tcp", "unix", "systemd"],
  })

const TransportKind = () =>
  string({
    enum: ["tcp", "unix"],
  })

const SSLMode = () =>
  string({
    enum: ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"],
  })

const ListenerConfig = () =>
  object(
    {
      kind: ListenerKind(),
      "addr?": NonEmptyString,
      "path?": NonEmptyString,
    },
    { "x-go-type-name": "ListenerConfig" },
  )

const APIConfig = () =>
  object({
    listener: ListenerConfig,
  })

const DBConfig = () =>
  object({
    host: NonEmptyString,
    port: int32({ minimum: 1, maximum: 65535 }),
    name: NonEmptyString,
    user: NonEmptyString,
    password: NonEmptyString,
    sslmode: SSLMode(),
    max_conns: int32({ minimum: 1 }),
  })

const TransportConfig = () =>
  object(
    {
      kind: TransportKind(),
      "path?": NonEmptyString,
    },
    { "x-go-type-name": "TransportConfig" },
  )

const ServiceConfig = () =>
  object({
    origin: NonEmptyString,
    transport: TransportConfig,
    timeout_ms: int32({ minimum: 1 }),
    max_attempts: int32({ minimum: 1 }),
  })

const Config = () =>
  object({
    api: APIConfig,
    db: DBConfig,
    sheets: ServiceConfig,
  })

const api = responsibleAPI({
  partialDoc: {
    openapi: "3.1.0",
    info: {
      title: "Recurring Config Schema",
      version: "1",
    },
  },
  routes: {},
  missingSchemas: [
    Config,
    APIConfig,
    ListenerConfig,
    DBConfig,
    ServiceConfig,
    TransportConfig,
    named("NonEmptyString", NonEmptyString()),
  ],
})

console.log(YAML.stringify(api, null, 2))
