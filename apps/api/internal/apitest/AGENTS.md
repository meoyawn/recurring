# Server tests

## Rules

- Never write SQL in this package. Put all SQL assertions and database
  inspection helpers in [internal/dbtest](../dbtest/).
- never use const values for ids and emails. Generate randomly, Tests are
  parallel
