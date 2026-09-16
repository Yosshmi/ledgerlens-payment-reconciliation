import { randomBytes, createHash } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import pino from "pino";
export const logger = pino({
  redact: [
    "req.headers.cookie",
    "req.headers.authorization",
    "password",
    "passwordHash",
    "token",
  ],
});
export const id = (prefix: string) =>
  `${prefix}_${randomBytes(9).toString("hex").toUpperCase()}`;
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const notFound: RequestHandler = (_req, _res, next) =>
  next(new AppError(404, "NOT_FOUND", "Resource was not found"));
export const errors: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res
      .status(422)
      .json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: err.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      });
    return;
  }
  if (err instanceof AppError) {
    res
      .status(err.status)
      .json({
        success: false,
        error: { code: err.code, message: err.message },
      });
    return;
  }
  if (err.code === 11000) {
    res
      .status(409)
      .json({
        success: false,
        error: {
          code: "CONFLICT",
          message: "A matching record already exists",
        },
      });
    return;
  }
  if (err.code === "LIMIT_FILE_SIZE") {
    res
      .status(413)
      .json({
        success: false,
        error: { code: "FILE_TOO_LARGE", message: "Upload limit is 10 MB" },
      });
    return;
  }
  logger.error({ name: err.name, message: err.message }, "Request failed");
  res
    .status(500)
    .json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed",
      },
    });
};
