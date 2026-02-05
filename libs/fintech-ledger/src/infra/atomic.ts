import { PoolClient } from 'pg';
import { getClient } from './postgres';

/**
 * Executes a callback within a database transaction.
 * Handles BEGIN, COMMIT, and ROLLBACK automatically.
 *
 * @param callback Function to execute with the transaction client
 * @param isolationLevel Optional isolation level (default: READ COMMITTED)
 */
export async function runAtomic<T>(
  callback: (client: PoolClient) => Promise<T>,
  isolationLevel: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' = 'READ COMMITTED',
): Promise<T> {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);

    const result = await callback(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      // If rollback fails, the connection is likely dead, verify logs
      console.error('Failed to rollback transaction', e);
    }
    throw error;
  } finally {
    client.release();
  }
}
