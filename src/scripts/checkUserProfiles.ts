import 'dotenv/config';
import mongoose from 'mongoose';
import Profile from '../models/Profile';

async function check() {
  await mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.MONGODB_DB || 'extrahand' });
  const profiles = await Profile.find({
    $or: [
      { phone: /0000000000/ },
      { phone: /7893396338/ },
      { uid: 'seller_7893396338' },
      { uid: 'ohTjWMhUWZakQoF0KYLGF0erO012' },
    ],
  }).lean();
  console.log('Profiles count:', profiles.length);
  for (const p of profiles) {
    console.log(`- Profile UID: ${p.uid}, phone: ${p.phone}, roles: ${p.roles}, selfie: ${(p as any).partnerProfile?.selfie}`);
  }
  await mongoose.disconnect();
}
check().catch(console.error);
