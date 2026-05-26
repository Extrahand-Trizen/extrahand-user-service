/**
 * Backfill referrerUid / refereeUid on ReferralRecord from Profile.uid
 * Run: npx ts-node scripts/backfill-referral-uids.ts
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { ReferralRecord } from '../src/models/ReferralRecord';
import Profile from '../src/models/Profile';

dotenv.config();

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  await mongoose.connect(uri);

  const records = await ReferralRecord.find({
    $or: [{ referrerUid: { $exists: false } }, { refereeUid: { $exists: false } }],
  });

  let updated = 0;
  for (const record of records) {
    const [referrer, referee] = await Promise.all([
      Profile.findById(record.referrerId),
      Profile.findById(record.refereeId),
    ]);
    if (!referrer?.uid || !referee?.uid) continue;
    await ReferralRecord.updateOne(
      { _id: record._id },
      { $set: { referrerUid: referrer.uid, refereeUid: referee.uid } }
    );
    updated += 1;
  }

  console.log(`Backfilled ${updated} referral records`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
