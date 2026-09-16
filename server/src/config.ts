import "dotenv/config";
import { z } from "zod";
export const config = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(4000),
    APP_ORIGIN: z.url().default("http://localhost:5173"),
    MONGODB_URI: z.string().min(1),
    REDIS_URL: z.url(),
    JWT_SECRET: z.string().min(32),
    WEBHOOK_SECRET: z.string().min(32),
    INTERNAL_SERVICE_SECRET: z.string().min(32),
    DJANGO_URL: z.url(),
    API_INTERNAL_URL: z.url().default("http://localhost:4000"),
    ENABLE_DEMO: z.enum(["true", "false"]).default("false"),
  })
  .parse(process.env);
