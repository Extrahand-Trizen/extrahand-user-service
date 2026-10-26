/**
 * Backfill Partner role and approved status for helper profiles that do not
 * already have the Partner role. Existing partner statuses are intentionally
 * set to approved by this explicit backfill.
 *
 * Dry run:
 *   npm run migrate:approve-existing-helper-partners
 * Apply changes:
 *   npm run migrate:approve-existing-helper-partners -- --execute
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/database';

const HELPER_ROLES = new Set(['tasker', 'helper', 'both']);
const ALLOWED_ROLES = new Set([
  ...HELPER_ROLES,
  'poster',
  'requester',
  'customer',
]);

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');

  const execute = process.argv.includes('--execute');
  await connectMongo(uri);

  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB database connection is unavailable');

  const profiles = db.collection('profiles');
  const cursor = profiles.find({
    roles: { $in: ['tasker', 'helper', 'both'] },
  });

  let matched = 0;
  let updated = 0;

  for await (const profile of cursor) {
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    const normalizedRoles = roles.map((role) => String(role).trim().toLowerCase());

    if (
      normalizedRoles.includes('partner') ||
      !normalizedRoles.some((role) => HELPER_ROLES.has(role)) ||
      normalizedRoles.some((role) => !ALLOWED_ROLES.has(role))
    ) {
      continue;
    }

    matched += 1;
    if (!execute) continue;

    const updateFilter = {
      _id: profile._id,
      roles: profile.roles,
    };
    const result = await profiles.updateOne(
      updateFilter,
      {
        $addToSet: { roles: 'partner' },
        $set: {
          'partnerProfile.status': 'approved',
          updatedAt: new Date(),
        },
      },
    );
    updated += result.modifiedCount;
  }

  console.log(
    execute
      ? `Matched ${matched} eligible profile(s); updated ${updated}.`
      : `Dry run: found ${matched} eligible profile(s). No changes made. Re-run with -- --execute to apply.`,
  );

  await disconnectMongo();
}

main().catch(async (error: unknown) => {
  console.error('Partner profile migration failed:', error);
  await disconnectMongo();
  process.exitCode = 1;
});
