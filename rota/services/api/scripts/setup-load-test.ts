/**
 * =============================================================================
 * Rota Load Test — Environment Setup & Seeding Script
 * =============================================================================
 * AGENTS.md §3.5 (D-06, D-07), rota-load-test skill & Phase 8 tasks:
 * - Creates 4 teams distributed across both shards (2 on Shard 0, 2 on Shard 1).
 * - Seeds 10,000 activity events in the primary team using seedFeed().
 * - Creates 200 verified users with active memberships.
 * - Pre-generates 200 access tokens saved to load-tests/tokens.json.
 * =============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { controlPlane, getShardDb, getShardId, closeDatabases } from '../src/db/index.js';
import { seedFeed } from '../src/modules/activity/seed-feed.js';
import { env } from '../src/config/env.js';

async function main() {
  console.log('--- Setting up k6 Load Test Environment (200 Users, 4 Teams, 10,000 Events) ---');

  // 1. Find or create 4 teams: 2 on Shard 0, 2 on Shard 1
  const teams: Array<{ id: string; name: string; shardId: 0 | 1 }> = [];
  let s0Count = 0;
  let s1Count = 0;

  while (teams.length < 4) {
    const id = crypto.randomUUID();
    const sid = getShardId(id);
    if (sid === 0 && s0Count < 2) {
      teams.push({ id, name: `K6 Team S0-${s0Count + 1}`, shardId: 0 });
      s0Count++;
    } else if (sid === 1 && s1Count < 2) {
      teams.push({ id, name: `K6 Team S1-${s1Count + 1}`, shardId: 1 });
      s1Count++;
    }
  }

  // 1. Create creator user in control plane first
  const creatorUserId = crypto.randomUUID();
  const creatorEmail = 'k6_creator@rotaloadtest.com';
  await controlPlane
    .insertInto('users')
    .values({
      id: creatorUserId,
      email: creatorEmail,
      email_normalized: creatorEmail.toLowerCase(),
      password_hash: 'k6_hash_mock',
      display_name: 'K6 Team Creator',
      email_verified_at: new Date(),
    })
    .onConflict((oc) => oc.column('email_normalized').doNothing())
    .execute();

  // Create team rows in shard & team_directory in control plane
  for (const t of teams) {
    await controlPlane
      .insertInto('team_directory')
      .values({
        team_id: t.id,
        shard_id: t.shardId,
      })
      .onConflict((oc) => oc.column('team_id').doNothing())
      .execute();

    const shardDb = getShardDb(t.id);
    await shardDb
      .insertInto('teams')
      .values({
        id: t.id,
        name: t.name,
        timezone: 'UTC',
        status: 'active',
        created_by_user_id: creatorUserId,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  const mainTeam = teams[0]!;
  console.log(`Main Team selected: ${mainTeam.id} on Shard ${mainTeam.shardId} (${mainTeam.name})`);

  // 2. Pre-create 200 users and memberships
  console.log('Creating 200 load test users and memberships...');
  const tokens: string[] = [];
  const mainShardDb = getShardDb(mainTeam.id);

  for (let i = 1; i <= 200; i++) {
    const userId = crypto.randomUUID();
    const email = `k6_user_${i}@rotaloadtest.com`;
    const tokenFamilyId = crypto.randomUUID();

    // Insert user into control plane
    await controlPlane
      .insertInto('users')
      .values({
        id: userId,
        email: email,
        email_normalized: email.toLowerCase(),
        password_hash: 'k6_hash_mock',
        display_name: `K6 User ${i}`,
        email_verified_at: new Date(),
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();

    // Insert membership into shard
    await mainShardDb
      .insertInto('team_memberships')
      .values({
        id: crypto.randomUUID(),
        team_id: mainTeam.id,
        user_id: userId,
        role: i === 1 ? 'owner' : i <= 10 ? 'manager' : 'staff',
        status: 'active',
        activated_at: new Date(),
      })
      .execute();

    // Pre-generate signed JWT (valid for 24h for load testing)
    const token = jwt.sign(
      {
        sub: userId,
        email,
        sid: tokenFamilyId,
      },
      env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    tokens.push(token);
  }

  // 3. Seed 10,000 realistic events into the main team
  console.log('Seeding 10,000 activity events in main team...');
  const seedResult = await seedFeed({
    teamId: mainTeam.id,
    count: 10000,
  });
  console.log(`Seeded ${seedResult.totalInserted} events successfully.`);

  // 4. Save output to load-tests/tokens.json
  const candidate1 = path.resolve(process.cwd(), '../load-tests');
  const candidate2 = path.resolve(process.cwd(), 'load-tests');
  const candidate3 = path.resolve(process.cwd(), '../../load-tests');
  const targetDir = fs.existsSync(candidate1) ? candidate1 : fs.existsSync(candidate2) ? candidate2 : candidate3;
  const outputPath = path.join(targetDir, 'tokens.json');

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        mainTeamId: mainTeam.id,
        mainTeamShard: mainTeam.shardId,
        teams: teams.map((t) => ({ id: t.id, shardId: t.shardId })),
        tokens,
      },
      null,
      2
    )
  );

  console.log(`Setup complete! Saved 200 tokens and team metadata to ${outputPath}`);
  await closeDatabases();
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Setup failed:', err);
  await closeDatabases();
  process.exit(1);
});
