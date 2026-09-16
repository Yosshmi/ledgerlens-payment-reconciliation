import { createApp } from "./app.js";
import { connect } from "./models.js";
import { config } from "./config.js";
import { logger } from "./utils.js";
import mongoose from "mongoose";
await connect();
const server = createApp().listen(config.PORT, () =>
  logger.info({ port: config.PORT }, "API listening"),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => void mongoose.disconnect().then(() => process.exit(0))),
  );
