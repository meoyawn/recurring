import { Link } from "inertia-adapter-solid"
import type { JSX } from "solid-js"

import type {
  Expense,
  Project as ProjectPayload,
} from "../../gen/models/index.ts"
import { Paths } from "../paths.ts"

type ProjectProps = {
  expenses: Expense[]
  projects: ProjectPayload[]
}

export default function Project(props: ProjectProps): JSX.Element {
  return (
    <main>
      <nav>
        <Link href={Paths.home}>Home</Link>
      </nav>
      <h1>Recurring</h1>
      <section>
        <h2>Projects</h2>
        <ul>
          {props.projects.map(project => (
            <li>
              <Link href={Paths.project(project.id)}>{project.name}</Link>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Expenses</h2>
        <ul>
          {props.expenses.map(expense => (
            <li>
              <strong>{expense.name}</strong> {expense.money.amount / 100}{" "}
              {expense.money.currency}
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
