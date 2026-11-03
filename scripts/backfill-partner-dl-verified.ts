/**
 * Backfill isDrivingLicenseVerified and drivingLicenseVerificationStatus
 * for partner profiles that:
 * 1. Have a valid dlNumber string saved, OR
 * 2. Already have driving or delivery_logistics category approved.
 *
 * Dry run:
 *   npm run migrate:partner-dl-verified
 * Apply changes:
 *   npm run migrate:partner-dl-verified -- --execute
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/database';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');

  const execute = process.argv.includes('--execute');
  await connectMongo(uri);

  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB database connection is unavailable');

  const profiles = db.collection('profiles');

  const filter = {
    $or: [
      { 'partnerProfile.dlNumber': { $type: 'string', $ne: '' } },
      { 'partnerProfile.categories': { $elemMatch: { $regex: /^(driving|delivery_logistics)$/i } } },
    ],
    $and: [
      {
        $or: [
          { 'partnerProfile.isDrivingLicenseVerified': { $ne: true } },
          { 'partnerProfile.drivingLicenseVerificationStatus': { $ne: 'verified' } },
        ],
      },
    ],
  };

  const matched = await profiles.countDocuments(filter);

  if (execute && matched > 0) {
    const result = await profiles.updateMany(filter, {
      $set: {
        'partnerProfile.isDrivingLicenseVerified': true,
        'partnerProfile.drivingLicenseVerificationStatus': 'verified',
        updatedAt: new Date(),
      },
    });
    console.log(`Matched ${matched} profile(s); updated ${result.modifiedCount}.`);
  } else {
    console.log(
      execute
        ? `No profiles needed updating (0 matched).`
        : `Dry run: found ${matched} profile(s) needing update. Re-run with -- --execute to apply.`,
    );
  }

  await disconnectMongo();
}

main().catch(async (error: unknown) => {
  console.error('Partner DL backfill migration failed:', error);
  await disconnectMongo();
  process.exitCode = 1;
});
