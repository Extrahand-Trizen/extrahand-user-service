/**
 * Set isPaymentTester: true / false for a user by phone number or UID.
 *
 * Usage:
 *   npx ts-node src/scripts/setPaymentTester.ts 9999999999 [true|false]
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Profile from '../models/Profile';

async function main() {
  const target = process.argv[2];
  const value = process.argv[3] !== 'false'; // default true

  if (!target) {
    console.error('Usage: setPaymentTester.ts <phone-or-uid> [true|false]');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  const dbName = process.env.MONGODB_DB || 'extrahand';
  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB database:', mongoose.connection.db?.databaseName);

  const clean = target.replace(/\D/g, '');
  const last10 = clean.slice(-10);
  const rx = new RegExp(last10 + '$');

  const filter = {
    $or: [
      { uid: target },
      { phone: rx },
      { phoneNumber: rx } as never,
      { mobileNumber: rx } as never,
    ],
  };

  const before = await Profile.find(filter).lean();
  if (before.length === 0) {
    console.log('No profiles found matching target:', target);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found ${before.length} matching profile(s):`);
  for (const p of before) {
    console.log(`- UID: ${p.uid}, Phone: ${p.phone}, Current isPaymentTester: ${p.isPaymentTester}`);
  }

  const result = await Profile.updateMany(filter, {
    $set: { isPaymentTester: value },
  });

  console.log(`\nUpdated ${result.modifiedCount} profile(s) with isPaymentTester = ${value} ✅`);

  const after = await Profile.find(filter).lean();
  for (const p of after) {
    console.log(`- UID: ${p.uid}, Phone: ${p.phone}, isPaymentTester now: ${p.isPaymentTester}`);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to set payment tester:', err);
  process.exit(1);
});

