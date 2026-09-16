import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { Session, User, roles } from "./models.js";
import { AppError, id } from "./utils.js";
export type Actor = {
  userId: string;
  organization: string;
  role: (typeof roles)[number];
  name: string;
  email: string;
  demo: boolean;
};
declare module "express-serve-static-core" {
  interface Request {
    actor: Actor;
    sessionId: string;
  }
}
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.ll_session;
    if (!token) throw new Error("Missing session");
    const claims = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: "ledgerlens",
      audience: "ledgerlens-browser",
    });
    if (typeof claims === "string" || typeof claims.sid !== "string")
      throw new Error("Invalid session");
    const session = await Session.findOne({
      sessionId: claims.sid,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!session) throw new Error("Expired session");
    const user = await User.findOne({ userId: session.userId }).lean();
    if (!user) throw new Error("Unknown user");
    req.actor = {
      userId: user.userId,
      organization: user.organization,
      role: user.role,
      name: user.name,
      email: user.email,
      demo: user.demo,
    };
    req.sessionId = session.sessionId;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-csrf-token"] !== session.csrf
    )
      throw new AppError(403, "CSRF_INVALID", "Refresh the page and try again");
    next();
  } catch (err) {
    next(
      err instanceof AppError
        ? err
        : new AppError(401, "UNAUTHENTICATED", "Please sign in"),
    );
  }
};
export const permit =
  (...allowed: Actor["role"][]): RequestHandler =>
  (req, _res, next) => {
    if (req.actor.demo)
      return next(
        new AppError(403, "DEMO_READ_ONLY", "The public demo is read-only"),
      );
    if (!allowed.includes(req.actor.role))
      return next(
        new AppError(403, "FORBIDDEN", "Your role does not permit this action"),
      );
    next();
  };
export const originGuard: RequestHandler = (req, _res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.path !== "/api/webhooks/gateway" &&
    req.headers.origin !== config.APP_ORIGIN
  )
    return next(
      new AppError(403, "ORIGIN_INVALID", "Request origin is not allowed"),
    );
  next();
};
export async function createSession(userId: string) {
  const sessionId = id("SES"),
    csrf = randomBytes(24).toString("hex");
  await Session.create({
    sessionId,
    userId,
    csrf,
    expiresAt: new Date(Date.now() + 8 * 3600_000),
  });
  const token = jwt.sign({ sid: sessionId }, config.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "8h",
    issuer: "ledgerlens",
    audience: "ledgerlens-browser",
  });
  return { token, csrf };
}
