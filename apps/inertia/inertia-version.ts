import { execFileSync } from "node:child_process"

export function inertiaVersion(): string {
  try {
    const gitVersion = execFileSync(
      "git",
      ["describe", "--tags", "--always", "--dirty"],
      { encoding: "utf8" },
    ).trim()
    return `recurring-inertia-${gitVersion}`
  } catch {
    return "recurring-inertia-dev"
  }
}
