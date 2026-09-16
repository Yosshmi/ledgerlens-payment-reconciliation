import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      MONGODB_URI:
        process.env.TEST_MONGODB_URI ??
        "mongodb://localhost:27017/ledgerlens_test?replicaSet=rs0",
      REDIS_URL: "redis://localhost:6379",
      JWT_SECRET: "test-only-jwt-key-not-for-production-12345",
      WEBHOOK_SECRET: "test-only-webhook-key-not-for-production",
      INTERNAL_SERVICE_SECRET: "test-only-internal-key-not-for-production",
      DJANGO_URL: "http://localhost:8000",
      APP_ORIGIN: "http://localhost:5173",
    },
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
