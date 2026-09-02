export type CliErrorCode = "CLI_USAGE_ERROR" | "CLI_INPUT_ERROR" | "CLI_INTERNAL_ERROR"

export class CliUsageError extends Error {
  readonly code = "CLI_USAGE_ERROR"

  constructor(message: string, readonly usage?: string) {
    super(message)
    this.name = "CliUsageError"
  }
}

export class CliInputError extends Error {
  constructor(message: string, readonly code: string = "CLI_INPUT_ERROR") {
    super(message)
    this.name = "CliInputError"
  }
}

export interface CliOptionSpec {
  allowed: readonly string[]
  boolean?: readonly string[]
  repeatable?: readonly string[]
  usage?: string
}

/** Validates CLI token shape without interpreting domain values. */
export function validateCommandArguments(argv: readonly string[], spec: CliOptionSpec): void {
  const allowed = new Set(spec.allowed)
  const boolean = new Set(spec.boolean ?? [])
  const repeatable = new Set(spec.repeatable ?? [])
  const seen = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith("--") || token.length === 2) {
      throw new CliUsageError(`Unexpected positional argument: ${token}.`, spec.usage)
    }
    const name = token.slice(2)
    if (!allowed.has(name)) throw new CliUsageError(`Unknown option: --${name}.`, spec.usage)
    if (seen.has(name) && !repeatable.has(name)) throw new CliUsageError(`Option --${name} may only be provided once.`, spec.usage)
    seen.add(name)

    if (boolean.has(name)) continue
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new CliUsageError(`--${name} requires a value.`, spec.usage)
    index += 1
  }
}

export function parseSafeInteger(value: string, name: string, minimum: number, usage?: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new CliUsageError(`--${name} must be an integer greater than or equal to ${minimum}.`, usage)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new CliUsageError(`--${name} must be a safe integer greater than or equal to ${minimum}.`, usage)
  return parsed
}

export interface SafeCliError {
  error: string
  code: string
  usage?: string
}

/** Converts only explicitly recognized errors; everything else fails closed. */
export function safeCliError(error: unknown, known?: (error: unknown) => SafeCliError | undefined): SafeCliError {
  if (error instanceof CliUsageError) return { error: error.message, code: error.code, ...(error.usage ? { usage: error.usage } : {}) }
  if (error instanceof CliInputError) return { error: error.message, code: error.code }
  const recognized = known?.(error)
  return recognized ?? { error: "An unexpected internal error occurred.", code: "CLI_INTERNAL_ERROR" }
}

export function formatCliError(error: SafeCliError): string {
  const envelope = JSON.stringify({ error: error.error, code: error.code })
  return error.usage ? `${envelope}\nUsage: ${error.usage}` : envelope
}
