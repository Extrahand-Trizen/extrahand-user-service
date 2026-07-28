/**
 * Remove referral enrollment + anti-abuse consumption for a phone number (testing reset).
 * Usage: npx ts-node --require dotenv/config scripts/clear-referral-by-phone.ts 8555896411
 */
import mongoose from 'mongoose';
import dns from 'dns';
import dotenv from 'dotenv';
import Profile from '../src/models/Profile';
import { ReferralRecord } from '../src/models/ReferralRecord';
import { ReferralRewardConsumption } from '../src/rewards/antiAbuse/models/ReferralRewardConsumption';
import { hashReferralPhone } from '../src/rewards/antiAbuse/utils/phoneHash.util';
import { buildPhoneSearchVariants } from '../src/utils/identityReconciliation';

dotenv.config();

const PHONE_LAST10 = (process.argv[2] || '').replace(/\D/g, '').slice(-10);

async function main() {
  if (!PHONE_LAST10 || PHONE_LAST10.length !== 10) {
    throw new Error('Provide a 10-digit phone number, e.g. 8555896411');
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  dns.setServers(['8.8.8.8', '8.8.4.4']);
  await mongoose.connect(uri);
  console.log('Connected. Clearing referral data for phone last10:', PHONE_LAST10);

  const phoneVariants = buildPhoneSearchVariants(PHONE_LAST10);
  const profiles = await Profile.find({
    $or: [
      { phone: { $in: phoneVariants } },
      { phone: { $regex: new RegExp(`${PHONE_LAST10}$`) } },
    ],
  })
    .select('_id uid phone name')
    .lean();

  console.log('\n--- Profiles found ---');
  console.log(JSON.stringify(profiles, null, 2));

  const profileIds = profiles.map((p) => p._id);
  const profileUids = profiles.map((p) => p.uid).filter(Boolean) as string[];
  const phoneHash = hashReferralPhone(PHONE_LAST10);
  console.log('\nphoneHash:', phoneHash);

  const enrollmentFilter: Record<string, unknown> = {
    $or: [
      ...(phoneHash ? [{ refereePhoneHash: phoneHash }] : []),
      ...(profileIds.length ? [{ refereeId: { $in: profileIds } }] : []),
      ...(profileUids.length ? [{ refereeUid: { $in: profileUids } }] : []),
    ],
  };

  const enrollments =
    enrollmentFilter.$or && (enrollmentFilter.$or as unknown[]).length
      ? await ReferralRecord.find(enrollmentFilter).lean()
      : [];

  console.log('\n--- Referral enrollments to delete (as referee) ---');
  console.log(
    enrollments.map((e) => ({
      id: e._id,
      status: e.status,
      grantsStatus: e.grantsStatus,
      referralCode: e.referralCode,
      referrerUid: e.referrerUid,
      refereeUid: e.refereeUid,
    }))
  );

  const consumptionFilter = phoneHash ? { phoneHash } : {};
  const consumptionRows = phoneHash
    ? await ReferralRewardConsumption.find(consumptionFilter).lean()
    : [];

  console.log('\n--- Consumption ledger rows to delete ---');
  console.log(consumptionRows);

  const enrollmentDelete =
    enrollmentFilter.$or && (enrollmentFilter.$or as unknown[]).length
      ? await ReferralRecord.deleteMany(enrollmentFilter)
      : { deletedCount: 0 };

  const consumptionDelete = phoneHash
    ? await ReferralRewardConsumption.deleteMany(consumptionFilter)
    : { deletedCount: 0 };

  console.log('\n--- Deleted ---');
  console.log({
    referralRecords: enrollmentDelete.deletedCount,
    consumptionRows: consumptionDelete.deletedCount,
  });

  await mongoose.disconnect();
  console.log('\nDone. Profile UIDs for payment cleanup:', profileUids);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
