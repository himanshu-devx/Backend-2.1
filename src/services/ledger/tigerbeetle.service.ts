// import { createClient, Client } from "tigerbeetle-node";
import type { Client } from "tigerbeetle-node";
import { ENV } from "@/config/env";

export class TigerBeetleService {
  private static _client: Client;

  /**
   * Initializes the TigerBeetle client and establishes a connection.
   * This method enforces a strict dependency: if it fails, it throws.
   */
  static async connect(): Promise<void> {
    if (this._client) {
      return;
    }

    console.log("🔌 Initializing TigerBeetle Client...");

    // Dynamically import tigerbeetle-node to avoid crashes on incompatible platforms (e.g. Windows + Bun)
    // when this service is imported but not used.
    const { createClient } = await import("tigerbeetle-node");

    this._client = createClient({
      cluster_id: BigInt(ENV.TIGERBEETLE_CLUSTER_ID || 0),
      replica_addresses: ENV.TIGERBEETLE_REPLICA_ADDRESSES.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });

    try {
      // Perform a lightweight operation to verify connection
      // lookup a non-existent account [0n]
      const checkPromise = this._client.lookupAccounts([0n]);

      // Enforce a strict timeout ensures we don't hang indefinitely
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Connection timed out")), 15000)
      );

      await Promise.race([checkPromise, timeoutPromise]);
      console.log("✅ TigerBeetle Connected Successfully");
    } catch (error: any) {
      console.error("❌ TigerBeetle Connection Failed:", error.message);
      // STRICT DEPENDENCY: Re-throw to prevent application startup
      throw error;
    }
  }

  /**
   * Returns the active TigerBeetle client instance.
   * Throws if not initialized.
   */
  static get client(): Client {
    if (!this._client) {
      throw new Error(
        "TigerBeetle client not initialized. Call connect() first."
      );
    }
    return this._client;
  }
}
