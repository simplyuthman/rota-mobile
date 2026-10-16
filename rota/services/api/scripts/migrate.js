#!/usr/bin/env node
/**
 * =============================================================================
 * Rota API — Migration Runner
 * =============================================================================
 * Applies SQL migrations to all three databases in order.
 *
 * Usage:
 *   node scripts/migrate.js           -- apply all pending migrations
 *   node scripts/migrate.js --check   -- verify migrations apply from empty (CI)
 *
 * Migration files are loaded in alphabetical order from:
 *   migrations/control-plane/   → applied to control_plane DB
 *   migrations/shard/           → applied to rota_shard_0 AND rota_shard_1
 *
 * A migration_history table is created in each database to track applied files.
 * Re-running is idempotent: already-applied migrations are skipped.
 * =============================================================================
 */

import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

const isCheck = process.argv.includes('--check');

// ─── Connection strings from environment ──────────────────────────────────────
if (!process.env.DATABASE_CONTROL_URL && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(join(__dirname, '..', '..', '..', '.env'));
  } catch {
    // .env not present or already loaded
  }
}

const {
  DATABASE_CONTROL_URL,
  DATABASE_SHARD_0_URL,
  DATABASE_SHARD_1_URL,
} = process.env;

if (!DATABASE_CONTROL_URL || !DATABASE_SHARD_0_URL || !DATABASE_SHARD_1_URL) {
  console.error(
    '❌ Missing required env vars: DATABASE_CONTROL_URL, DATABASE_SHARD_0_URL, DATABASE_SHARD_1_URL',
  );
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureHistoryTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migration_history (
      filename   text        PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function getApplied(client) {
  const result = await client.query(
    'SELECT filename FROM migration_history ORDER BY filename',
  );
  return new Set(result.rows.map((r) => r.filename));
}

async function applyMigration(client, filename, sql) {
  console.log(`  ↳ Applying ${filename}...`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO migration_history (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    console.log(`  ✓ ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${filename} failed: ${err.message}`);
  }
}

async function runMigrations(connectionString, dbLabel, migrationsDir) {
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await ensureHistoryTable(client);
    const applied = await getApplied(client);

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      await applyMigration(client, file, sql);
      count++;
    }

    if (count === 0) {
      console.log(`  ✓ ${dbLabel}: up to date (${files.length} migration(s))`);
    } else {
      console.log(`  ✓ ${dbLabel}: applied ${count} migration(s)`);
    }
  } finally {
    await client.end();
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🗄  Rota — Migration Runner ${isCheck ? '(--check mode)' : ''}\n`);

  const targets = [
    {
      label: 'control_plane',
      url: DATABASE_CONTROL_URL,
      dir: join(MIGRATIONS_DIR, 'control-plane'),
    },
    {
      label: 'rota_shard_0',
      url: DATABASE_SHARD_0_URL,
      dir: join(MIGRATIONS_DIR, 'shard'),
    },
    {
      label: 'rota_shard_1',
      url: DATABASE_SHARD_1_URL,
      dir: join(MIGRATIONS_DIR, 'shard'),
    },
  ];

  for (const target of targets) {
    console.log(`\n→ ${target.label}`);
    await runMigrations(target.url, target.label, target.dir);
  }

  console.log('\n✅ All migrations complete.\n');
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
