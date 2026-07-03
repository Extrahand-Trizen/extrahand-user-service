/**
 * One-time migration: replace legacy role string `requester` with `poster` in Profile.roles arrays.
 * Does not delete profiles or other fields — only rewrites role tokens.
 *
 * Run once against production/staging before or shortly after deploying schema enum without `requester`:
 *   npx ts-node --require dotenv/config scripts/migrate-roles-requester-to-poster.ts
 *
 * Requires: MONGODB_URI in `.env`
 */

import dotenv from 'dotenv';
dotenv.config();

import { connectMongo, disconnectMongo } from '../src/config/database';
import Profile from '../src/models/Profile';

function normalizeStoredRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  const next = roles.map((r) =>
    String(r || '').trim().toLowerCase() === 'requester' ? 'poster' : String(r || ''),
  );
  return [...new Set(next.filter(Boolean))];
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await connectMongo(uri);

  const query = { roles: 'requester' as unknown as string };
  const total = await Profile.countDocuments(query);
  console.log(`Found ${total} profile(s) with roles containing "requester"`);

  const cursor = Profile.find(query).cursor();
  let updated = 0;

  for await (const doc of cursor) {
    const raw = doc.roles as unknown as string[];
    const normalized = normalizeStoredRoles(raw);
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      await Profile.updateOne({ _id: doc._id }, { $set: { roles: normalized } });
      updated += 1;
    }
  }

  console.log(`Updated ${updated} profile document(s).`);
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
