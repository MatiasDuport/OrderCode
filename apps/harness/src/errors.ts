export class HarnessError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
    this.details = details;
  }
}

export function errorPayload(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (error instanceof HarnessError) {
    return { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
  }
  if (error instanceof Error) return { code: "INTERNAL_ERROR", message: error.message };
  return { code: "INTERNAL_ERROR", message: String(error) };
}
