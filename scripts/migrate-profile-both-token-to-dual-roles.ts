/**
 * One-time migration: remove legacy `both` role token from Profile.roles arrays.
 * Expands `both` into poster + tasker (sorted as ['poster','tasker']).
 * Does not delete profiles — only rewrites the roles array.
 *
 * Run once after deploying schema without `both`:
 *   npm run migrate:profile-both-token-to-dual-roles
 *
 * Requires: MONGODB_URI in `.env`
 */

import dotenv from 'dotenv';
dotenv.config();

import { connectMongo, disconnectMongo } from '../src/config/database';
import Profile from '../src/models/Profile';

function expandRolesArray(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  const out = new Set<string>();
  for (const raw of roles) {
    const r = String(raw || '').trim().toLowerCase();
    if (r === 'both') {
      out.add('poster');
      out.add('tasker');
    } else if (r === 'requester') {
      out.add('poster');
    } else if (r === 'performer') {
      out.add('tasker');
    } else if (r === 'poster' || r === 'tasker') {
      out.add(r);
    }
  }
  return Array.from(out).sort();
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await connectMongo(uri);

  const query = { roles: 'both' as unknown as string };
  const total = await Profile.countDocuments(query);
  console.log(`Found ${total} profile(s) with roles containing "both"`);

  const cursor = Profile.find(query).cursor();
  let updated = 0;

  for await (const doc of cursor) {
    const next = expandRolesArray(doc.roles as unknown);
    const prev = JSON.stringify(doc.roles);
    const nxt = JSON.stringify(next);
    if (prev !== nxt) {
      await Profile.updateOne({ _id: doc._id }, { $set: { roles: next } });
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
