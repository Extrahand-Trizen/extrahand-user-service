/**
 * One-off: inspect + trigger referral grants for a test phone.
 * Usage: npx ts-node --require dotenv/config scripts/test-referral-grant-flow.ts [last10]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Profile from '../src/models/Profile';
import { ReferralRecord } from '../src/models/ReferralRecord';
import { ReferralRewardConsumption } from '../src/rewards/antiAbuse/models/ReferralRewardConsumption';
import { createPlatformEvent } from '../src/rewards/events/InProcessEventBus';
import { QualificationEngine } from '../src/rewards/qualification/QualificationEngine';
import { ReferralGrantReissue } from '../src/rewards/referral/ReferralGrantReissue';
import { hashReferralPhone } from '../src/rewards/antiAbuse/utils/phoneHash.util';

dotenv.config();

const PHONE_LAST10 = (process.argv[2] || '7416337859').replace(/\D/g, '').slice(-10);

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  await mongoose.connect(uri);
  console.log('Connected. Phone last10:', PHONE_LAST10);

  const profiles = await Profile.find({
    phone: { $regex: `${PHONE_LAST10}$` },
  })
    .select('uid phone name isAadhaarVerified roles _id')
    .lean();

  console.log('\n--- Profiles ---');
  console.log(JSON.stringify(profiles, null, 2));

  if (!profiles.length) {
    console.log('No profile found for phone');
    await mongoose.disconnect();
    return;
  }

  const profile = profiles[0];
  const uid = profile.uid as string;
  const phoneHash = hashReferralPhone(profile.phone as string);
  console.log('\nphoneHash prefix:', phoneHash?.slice(0, 12));

  const enrollments = await ReferralRecord.find({
    $or: [{ refereeUid: uid }, { referrerUid: uid }],
  })
    .sort({ createdAt: -1 })
    .lean();

  console.log('\n--- Referral enrollments ---');
  for (const e of enrollments) {
    console.log({
      id: e._id,
      status: e.status,
      grantsStatus: e.grantsStatus,
      referrerUid: e.referrerUid,
      refereeUid: e.refereeUid,
      qualificationMode: (e.rewardProgramSnapshot as any)?.referral?.qualificationMode,
      refereePhoneHash: (e as any).refereePhoneHash?.slice(0, 12),
    });
  }

  const consumption = phoneHash
    ? await ReferralRewardConsumption.find({ phoneHash }).lean()
    : [];
  console.log('\n--- Consumption ledger ---');
  console.log(consumption);

  const asReferee = await ReferralRecord.findOne({ refereeUid: uid }).sort({ createdAt: -1 });

  console.log('\n--- Before: isAadhaarVerified =', profile.isAadhaarVerified);

  await Profile.updateOne(
    { uid },
    { $set: { isAadhaarVerified: true, aadhaarVerifiedAt: new Date() } }
  );

  const event = createPlatformEvent(
    'IDENTITY_VERIFIED',
    {
      uid,
      refereeUid: uid,
      referrerUid: uid,
      verificationType: 'aadhaar',
      testScript: true,
    },
    `test-script:${uid}:${Date.now()}`
  );

  console.log('\n--- Running QualificationEngine.processDomainEvent (IDENTITY_VERIFIED) ---');
  const qualResult = await QualificationEngine.processDomainEvent(event);
  console.log('qualResult:', qualResult);

  if (asReferee) {
    console.log('\n--- Running ReferralGrantReissue for referee enrollment ---');
    const reissue = await ReferralGrantReissue.reissue(asReferee._id.toString());
    console.log('reissue:', reissue);
  }

  const afterProfile = await Profile.findOne({ uid }).select('isAadhaarVerified').lean();
  const afterEnrollment = asReferee
    ? await ReferralRecord.findById(asReferee._id).select('status grantsStatus').lean()
    : null;

  console.log('\n--- After ---');
  console.log('profile.isAadhaarVerified:', afterProfile?.isAadhaarVerified);
  console.log('enrollment:', afterEnrollment);

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
