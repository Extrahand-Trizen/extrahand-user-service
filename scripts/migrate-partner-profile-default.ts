/**
 * One-time migration: ensure partnerProfile defaults on all profiles missing the subdoc.
 *
 * Run:
 *   npx ts-node --require dotenv/config scripts/migrate-partner-profile-default.ts
 *   npx ts-node --require dotenv/config scripts/migrate-partner-profile-default.ts execute
 */

import dotenv from 'dotenv';
dotenv.config();

import { connectMongo, disconnectMongo } from '../src/config/database';
import Profile from '../src/models/Profile';

const DRY_RUN = !process.argv.includes('execute');

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await connectMongo(uri);

  const query = {
    $or: [{ partnerProfile: { $exists: false } }, { partnerProfile: null }],
  };
  const total = await Profile.countDocuments(query);
  console.log(`Found ${total} profile(s) without partnerProfile (${DRY_RUN ? 'DRY RUN' : 'EXECUTE'})`);

  if (DRY_RUN) {
    await disconnectMongo();
    return;
  }

  const result = await Profile.updateMany(query, {
    $set: {
      partnerProfile: {
        status: 'not_applied',
        onboardingCompleted: false,
        languages: [],
      },
    },
  });

  console.log(`Updated ${result.modifiedCount} profile(s)`);
  await disconnectMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
