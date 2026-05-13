# rules that waste time

- never skip running `task check` after modifying `apps/**/*` or `packages/**/*`
  (but not when staging/commiting)
- never skip running `task check` after editing `./**/*.go`
- never run `task check` without escalating permissions (has docker calls
  inside)
