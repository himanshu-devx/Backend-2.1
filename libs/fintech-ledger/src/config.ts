import dotenv from 'dotenv';
dotenv.config();

export const config = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'ledger',
  },
  // Feature Flags for Production optimization
  features: {
    bulkWriter: true,
    eventBus: true,
  },
};
