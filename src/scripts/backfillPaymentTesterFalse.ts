/**
 * Set isPaymentTester=false for every existing profile.
 *
 * Run with:
 *   npx ts-node --require dotenv/config src/scripts/backfillPaymentTesterFalse.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Profile from '../models/Profile';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  const dbName = process.env.MONGODB_DB || 'extrahand';
  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB database:', mongoose.connection.db?.databaseName);

  const result = await Profile.updateMany({}, { $set: { isPaymentTester: false } });
  console.log(`Updated ${result.matchedCount} profile(s); modified ${result.modifiedCount} profile(s).`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Failed to backfill isPaymentTester:', error);
  await mongoose.disconnect();
  process.exit(1);
});
