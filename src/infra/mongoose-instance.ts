import mongoose from "mongoose";
import { ENV } from "@/config/env";
import { logger } from "@/infra/logger-instance";

let isConnected = false;

export async function connectMongo() {
  if (isConnected) return;

  const uri = ENV.MONGODB_URI;
  const dbName = ENV.MONGO_DB_NAME;

  if (!uri || !dbName) {
    throw new Error("MONGODB_URI or MONGO_DB_NAME not configured");
  }

  mongoose.set("strictQuery", true);

  try {
    logger.info(`MongoDB connecting to ${dbName}...`);

    await mongoose.connect(uri, {
      dbName,
      maxPoolSize: 30,
      minPoolSize: 3,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 8000,
      socketTimeoutMS: 120000
    });

    isConnected = true;

    logger.info(`MongoDB connected to database: ${dbName}`);

    mongoose.connection.on("error", (err) => {
      logger.error("MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected");
      isConnected = false;
    });
  } catch (err:any) {
    logger.error(err, "MongoDB connection failed");
    process.exit(1);
  }
}

export async function closeMongo() {
  if (!isConnected) return;

  try {
    await mongoose.disconnect();
    logger.info("MongoDB disconnected gracefully");
  } catch (err:any) {
    logger.error("Error during MongoDB disconnect:", err);
  } finally {
    isConnected = false;
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("SIGINT received. Closing Mongo...");
  await closeMongo();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received. Closing Mongo...");
  await closeMongo();
  process.exit(0);
});

export { mongoose };
