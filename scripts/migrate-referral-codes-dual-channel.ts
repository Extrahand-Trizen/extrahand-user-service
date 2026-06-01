/**
 * Backfill ReferralCode.channel and create missing tasker codes.
 * Usage: npx ts-node scripts/migrate-referral-codes-dual-channel.ts [--execute]
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { ReferralCode } from '../src/models/ReferralCode';
import { ensureDualReferralCodes } from '../src/services/referralCodeService';
import Profile from '../src/models/Profile';

dotenv.config();

const execute = process.argv.includes('--execute');

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);

  const collection = mongoose.connection.collection('referralcodes');
  const indexes = await collection.indexes();
  const legacyUserIdUnique = indexes.find(
    (idx) =>
      idx.unique === true &&
      idx.key &&
      Object.keys(idx.key).length === 1 &&
      idx.key.userId === 1
  );
  const hasCompoundUnique = indexes.some(
    (idx) =>
      idx.unique === true &&
      idx.key &&
      idx.key.userId === 1 &&
      idx.key.channel === 1
  );

  if (legacyUserIdUnique) {
    const legacyIndexName = legacyUserIdUnique.name || 'userId_1';
    console.log(`Legacy unique index detected: ${legacyIndexName}`);
    if (execute) {
      await collection.dropIndex(legacyIndexName);
      console.log(`Dropped legacy unique index: ${legacyIndexName}`);
    } else {
      console.log(`Would drop legacy unique index: ${legacyIndexName}`);
    }
  }

  if (!hasCompoundUnique) {
    console.log('Compound unique index { userId: 1, channel: 1 } missing');
    if (execute) {
      await collection.createIndex({ userId: 1, channel: 1 }, { unique: true });
      console.log('Created compound unique index: userId_1_channel_1');
    } else {
      console.log('Would create compound unique index: userId_1_channel_1');
    }
  }

  const withoutChannel = await ReferralCode.find({
    $or: [{ channel: { $exists: false } }, { channel: null }, { channel: '' }],
  });

  console.log(`Codes missing channel: ${withoutChannel.length}`);

  for (const row of withoutChannel) {
    console.log(`  Would set poster channel on code ${row.code} userId=${row.userId}`);
    if (execute) {
      await ReferralCode.updateOne({ _id: row._id }, { $set: { channel: 'poster' } });
    }
  }

  const userIds = await ReferralCode.distinct('userId');
  let taskerCreated = 0;

  for (const userId of userIds) {
    const hasTasker = await ReferralCode.findOne({ userId, channel: 'tasker' });
    if (hasTasker) continue;

    const profile = await Profile.findById(userId);
    const name = profile?.name || 'User';
    console.log(`  Would create tasker code for userId=${userId}`);
    if (execute) {
      await ensureDualReferralCodes(userId as mongoose.Types.ObjectId, name);
      taskerCreated++;
    } else {
      taskerCreated++;
    }
  }

  const posterCount = await ReferralCode.countDocuments({ channel: 'poster' });
  const taskerCount = await ReferralCode.countDocuments({ channel: 'tasker' });
  console.log(`After: poster=${posterCount} tasker=${taskerCount} taskerCreated=${taskerCreated}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
