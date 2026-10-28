/**
 * Script to upload/set a live selfie image for a partner / seller account.
 * Specifically updates:
 *  1. User Profile in extrahand-user-service (partnerProfile.selfie and photoURL)
 *  2. SellerOnboarding in extrahand DB (kycSelfieUri)
 *
 * Usage:
 *   npx ts-node src/scripts/setPartnerSelfie.ts [phone] [selfieUrl]
 *
 * Example:
 *   npx ts-node src/scripts/setPartnerSelfie.ts 7893396338
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Profile from '../models/Profile';

const DEFAULT_PHONE = '7893396338';
const DEFAULT_SELFIE_URL =
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80';

async function main() {
  const phone = process.argv[2] || DEFAULT_PHONE;
  const selfieUrl = process.argv[3] || DEFAULT_SELFIE_URL;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing in .env');
  const dbName = process.env.MONGODB_DB || 'extrahand';

  await mongoose.connect(uri, { dbName });
  console.log('Connected to MongoDB database:', mongoose.connection.db?.databaseName);

  const last10 = phone.replace(/\D/g, '').slice(-10);
  const rx = new RegExp(last10 + '$');

  // 1. Update Profile in user-service
  let profile = await Profile.findOne({
    $or: [
      { phone: rx },
      { phoneNumber: rx } as never,
      { mobileNumber: rx } as never,
      { uid: phone },
      { uid: `seller_${last10}` },
    ],
  });

  if (!profile) {
    console.warn(`⚠️ No user-service Profile found matching phone ending in ${last10}, creating/upserting profile...`);
    profile = new Profile({
      uid: `seller_${last10}`,
      phone: `+91${last10}`,
      roles: ['seller'],
      photoURL: selfieUrl,
      partnerProfile: { selfie: selfieUrl },
    });
    await profile.save();
    console.log(`✅ [extrahand-user-service] Created Profile for seller_${last10}:`, profile.phone);
  } else {
    profile.photoURL = selfieUrl;
    if (!profile.partnerProfile) {
      (profile as any).partnerProfile = {};
    }
    (profile.partnerProfile as any).selfie = selfieUrl;
    profile.markModified('partnerProfile');
    await profile.save();

    console.log(`✅ [extrahand-user-service] Successfully updated Profile for ${profile.phone}:`);
    console.log(`   - UID: ${profile.uid}`);
    console.log(`   - partnerProfile.selfie: ${selfieUrl}`);
    console.log(`   - photoURL: ${selfieUrl}`);
  }

  // 2. Also update SellerOnboarding and SellerDocument in extrahand database
  try {
    const sellersCol = mongoose.connection.collection('sellers');
    const sellers = await sellersCol.find({ mobileNumber: rx }).toArray();
    const sellerIds = sellers.map((s) => s._id);

    const onboardingCollection = mongoose.connection.collection('selleronboardings');
    const updateResult = await onboardingCollection.updateMany(
      { $or: [{ mobileNumber: rx }, { sellerId: { $in: sellerIds } }] },
      { $set: { kycSelfieUri: selfieUrl, updatedAt: new Date() } }
    );
    console.log(`✅ [seller-backend] Updated ${updateResult.modifiedCount} seller onboarding document(s) with kycSelfieUri.`);

    const docsCollection = mongoose.connection.collection('sellerdocuments');
    for (const sid of sellerIds) {
      await docsCollection.updateOne(
        { sellerId: sid, documentType: 'SELFIE' },
        {
          $set: {
            fileName: 'Live Selfie',
            fileUrl: selfieUrl,
            mimeType: 'image/jpeg',
            verificationStatus: 'VERIFIED',
            uploadedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }
    console.log(`✅ [seller-backend] Upserted SELFIE document into sellerdocuments for ${sellerIds.length} seller(s).`);
  } catch (err: any) {
    console.warn('Note: Could not update selleronboardings/documents collection:', err?.message);
  }

  console.log('\n🎉 Finished updating selfie photo for phone:', phone);
  console.log('   Image URL:', selfieUrl);
  console.log('   Now when you open or refresh the app, the live selfie will show as captured!\n');

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('❌ Error executing setPartnerSelfie script:', e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
