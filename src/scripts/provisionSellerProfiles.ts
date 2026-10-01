/**
 * Provisions missing Profile records in user-service for approved sellers
 * so that Firebase UID resolution and seller role linkage succeed.
 *
 *   npx ts-node src/scripts/provisionSellerProfiles.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Profile from '../models/Profile';

const SELLERS = [
  { sellerId: '6a955e0109cbcd3f2d2e53b9', phone: '7793997897', uid: 'Xj4IOIga0cgoFdlOoqxf26YceqC2', name: 'Allam' },
  { sellerId: '6a996c3990e4e82c50e8e3b7', phone: '9063605916', uid: 'CHG3kPRkCITDxazznY9x0DgmHPp2', name: 'Nukaraju Neradabilli' },
  { sellerId: '6a9a674176da10e60177a5f6', phone: '9182419930', uid: 'B0jIT1P8MPS6vuDZxITDEpltxQr1', name: 'Test Seller' },
  { sellerId: '6a9ea407bf1f19c11392d90c', phone: '9781575441', uid: 'rr-user-1788781575441', name: 'RR Seller' },
  { sellerId: '6a9fb9afaa2312ba02e73bd0', phone: '9010753557', uid: 'S5rVchzgEITKlahqydTzogWEW8s1', name: 'Sandeep Reddy' },
  { sellerId: '6a9feace2f792d9690abeffa', phone: '7729039020', uid: 'hIG0WhROMATkjD26tB7YKBfYSmB2', name: 'New Owner' },
  { sellerId: '6aa040cbf0e1288c305a927e', phone: '9603698176', uid: 'y711Kc63UtYIYBp2pQ9GK2jVwmj1', name: 'Pavan' },
  { sellerId: '6aa1223b0947553f77210714', phone: '7893396338', uid: 'ohTjWMhUWZakQoF0KYLGF0erO012', name: 'Venkatesh' },
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  const dbName = process.env.MONGODB_DB || 'extrahand';
  await mongoose.connect(uri, { dbName });
  console.log(`\nConnected to user-service DB (${dbName})\n`);

  for (const s of SELLERS) {
    const phoneFormatted = `+91${s.phone.replace(/\D/g, '').slice(-10)}`;
    
    // Check if profile exists by UID or Phone
    let profile = await Profile.findOne({
      $or: [{ uid: s.uid }, { phone: phoneFormatted }, { phone: s.phone }],
    });

    if (profile) {
      // Update existing
      await Profile.updateOne(
        { _id: profile._id },
        {
          $addToSet: { roles: 'seller' },
          $set: {
            uid: s.uid,
            phone: phoneFormatted,
            'sellerProfile.sellerId': s.sellerId,
            updatedAt: Date.now(),
          },
        },
      );
      console.log(`  ✓ Updated profile for ${s.name} (${s.phone}) -> uid: ${s.uid}`);
    } else {
      // Create new profile
      const now = Date.now();
      await Profile.create({
        uid: s.uid,
        name: s.name,
        phone: phoneFormatted,
        client_type: 'mobile',
        roles: ['seller'],
        sellerProfile: { sellerId: s.sellerId },
        userType: 'individual',
        isActive: true,
        isVerified: true,
        createdAt: now,
        updatedAt: now,
      } as never);
      console.log(`  + Created profile for ${s.name} (${s.phone}) -> uid: ${s.uid}`);
    }
  }

  console.log('\nAll seller profiles provisioned successfully in user-service!\n');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
