#!/usr/bin/env bun

import doneDocument from "./DONE.yaml" with { type: "yaml" }
import todoDocument from "./TODO.yaml" with { type: "yaml" }

const taskIdPattern = /^t_(\d+)$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function main() {
  let maxTaskId = 0

  for (const document of [todoDocument, doneDocument]) {
    if (!isRecord(document)) {
      continue
    }

    for (const taskId of Object.keys(document)) {
      const match = taskIdPattern.exec(taskId)
      if (match === null) {
        continue
      }

      maxTaskId = Math.max(maxTaskId, Number(match[1]))
    }
  }

  console.log(maxTaskId + 1)
}

if (import.meta.main) {
  main()
}
