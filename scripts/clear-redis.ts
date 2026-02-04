
import { redis } from "../src/infra/redis-instance";

async function clearCache() {
    try {
        console.log("Clearing Redis cache...");
        await redis.flushall();
        console.log("Redis cache cleared successfully.");
        process.exit(0);
    } catch (error) {
        console.error("Error clearing Redis cache:", error);
        process.exit(1);
    }
}

clearCache();
