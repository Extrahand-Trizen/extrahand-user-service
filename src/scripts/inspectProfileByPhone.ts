/**
 * Diagnostic (read-only): show the Profile(s) for a phone — uid, roles,
 * sellerProfile link, isActive. Helps explain a seller-app "bounced to
 * registration" after login.
 *
 *   npx ts-node src/scripts/inspectProfileByPhone.ts 7893396338
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Profile from '../models/Profile';

async function main() {
  const phone = process.argv[2];
  if (!phone) throw new Error('usage: inspectProfileByPhone.ts <phone>');

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');
  const dbName = process.env.MONGODB_DB || 'extrahand';
  await mongoose.connect(uri, { dbName });
  console.log('connected db:', mongoose.connection.db?.databaseName);

  const last10 = phone.replace(/\D/g, '').slice(-10);
  const rx = new RegExp(last10 + '$');

  const profiles = await Profile.find({
    $or: [{ phone: rx }, { phoneNumber: rx } as never, { mobileNumber: rx } as never],
  }).lean();

  console.log(`\n--- Profile rows matching /${last10}$/ : ${profiles.length} ---`);
  for (const p of profiles as Array<Record<string, unknown>>) {
    console.log({
      _id: String(p._id),
      uid: p.uid,
      phone: p.phone,
      roles: p.roles,
      isActive: p.isActive,
      client_type: p.client_type,
      sellerProfile: p.sellerProfile,
      deletedAt: p.deletedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
