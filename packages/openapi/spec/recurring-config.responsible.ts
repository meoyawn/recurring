#!/usr/bin/env bun

/**
 * OpenAPI 3.1 wrapper around the JSON Schema for files in apps/api/config.
 *
 * Runtime config is loaded with koanf: https://github.com/knadh/koanf. This
 * spec intentionally has no routes; OpenAPI is used only as the schema envelope
 * because direct JSON Schema to Go struct generators had unreliable support for
 * composition such as oneOf.
 */

import { int32, object, ref, responsibleAPI, string } from "@responsibleapi/ts"
import { YAML } from "bun"

import { NonEmptyString } from "./shared.responsible.ts"

const EndpointKind = () =>
  string({
    enum: ["tcp", "unix", "systemd"],
  })

const SSLMode = () =>
  string({
    enum: ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"],
  })

const ListenerConfig = () =>
  object({
    kind: EndpointKind,
    "addr?": NonEmptyString,
    "path?": NonEmptyString,
  })

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
    sslmode: SSLMode,
    max_conns: int32({ minimum: 1 }),
  })

const TransportConfig = () =>
  object({
    kind: EndpointKind,
    "path?": NonEmptyString,
  })

const ServiceConfig = () =>
  object({
    origin: NonEmptyString,
    transport: TransportConfig,
    timeout_ms: int32({ minimum: 1 }),
    max_attempts: int32({ minimum: 1 }),
  })

const TelemetryConfig = () =>
  object({
    deployment_environment: ref(NonEmptyString, {
      description:
        "Runtime environment label added to every API trace, for example local, staging, or production. Observability backends use it to filter and compare spans from different deployments.",
    }),
    "otlp_endpoint?": NonEmptyString,
    "otlp_traces_endpoint?": NonEmptyString,
  })

const Config = () =>
  object({
    api: APIConfig,
    db: DBConfig,
    sheets: ServiceConfig,
    telemetry: TelemetryConfig,
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
  missingSchemas: [Config],
})

console.log(YAML.stringify(api, null, 2))
