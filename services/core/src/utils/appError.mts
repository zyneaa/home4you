export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code?: string | undefined;
  public readonly isOperational: boolean;

  constructor(
    message: string | string[],
    statusCode = 500,
    code?: string,
    isOperational = true,
  ) {
    const normalizedMessage = Array.isArray(message)
      ? message.join("; ")
      : message;

    super(normalizedMessage);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace?.(this, this.constructor);
  }
}
