import { DefaultApi } from "../../gen/apis/DefaultApi.ts"
import { Configuration } from "../../gen/runtime.ts"

export const recurringAPIClient = (basePath: string): DefaultApi =>
  new DefaultApi(new Configuration({ basePath }))
