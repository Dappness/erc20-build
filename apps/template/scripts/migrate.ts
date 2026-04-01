import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log('DATABASE_URL not set, skipping migration');
  process.exit(0);
}

const sql = neon(databaseUrl);
const db = drizzle(sql);

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, '../../../packages/db/drizzle');

console.log('Running database migrations...');
await migrate(db, { migrationsFolder });
console.log('Migrations complete');
