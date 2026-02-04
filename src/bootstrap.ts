import { connectMongo } from "./infra/mongoose-instance";
import { logger } from "./infra/logger-instance";
import { TigerBeetleService } from "@/services/ledger/tigerbeetle.service";
// import { checkTigerBeetleConnection } from "./infra/tigerbeetle";

export async function bootstrap() {
  await connectMongo();

  // TigerBeetle connection check is currently disabled due to
  // native binding compatibility issues with Bun on Windows.
  // Uncomment the following if running in Node.js and TigerBeetle is required.

  // TigerBeetle connection check is currently disabled due to
  // native binding compatibility issues with Bun on Windows.
  // We allow it for Linux/Docker environments.

  const isBun = !!(process.versions as any).bun;
  const isWindows = process.platform === "win32";

  if (!isBun || !isWindows) {
    try {
      await TigerBeetleService.connect();
    } catch (err: any) {
      logger.error("Failed to load TigerBeetle: " + err.message);
      process.exit(1);
    }
  }

  logger.info("Bootstrap initialized");
}
