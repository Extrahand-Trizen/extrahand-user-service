/**
 * Debug location-notify waitlist vs helper profile city.
 * Usage: npx ts-node src/scripts/debugLocationNotify.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'node:dns';

dns.setServers(['8.8.8.8', '8.8.4.4']);
dotenv.config();

const POSTER_UID = '2QhjF3V4JjPohy1363mjintWm0j2';
const HELPER_UID = 'DGHDIXdHwfOOuj5jVfRAPfKXTLX2';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  console.log('NOTIFICATION_SERVICE_URL:', process.env.NOTIFICATION_SERVICE_URL || '(NOT SET)');
  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'extrahand' });

  const requests = await mongoose.connection
    .collection('location_notify_requests')
    .find({ userId: POSTER_UID })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  console.log('\nCustomer notify requests:', requests.length);
  for (const r of requests) {
    console.log({
      status: r.status,
      city: r.city,
      locality: r.locality,
      locationKey: r.locationKey,
      notifiedAt: r.notifiedAt,
      createdAt: r.createdAt,
    });
  }

  const helper = await mongoose.connection.collection('profiles').findOne(
    { uid: HELPER_UID },
    { projection: { uid: 1, roles: 1, isActive: 1, location: 1, name: 1 } },
  );
  console.log('\nHelper profile:', JSON.stringify(helper, null, 2));

  const poster = await mongoose.connection.collection('profiles').findOne(
    { uid: POSTER_UID },
    { projection: { uid: 1, location: 1, name: 1 } },
  );
  console.log('\nPoster profile location:', JSON.stringify(poster?.location, null, 2));

  const { LocationNotifyService } = await import('../services/LocationNotifyService');
  const { resolveProfileCityForMatching } = await import('../utils/normalizeProfileLocation');
  const helperCity = resolveProfileCityForMatching(helper?.location as any);
  console.log('\nResolved helper city:', helperCity);

  if (helperCity) {
    console.log('\n→ Manually running notifyWaitersForHelperCity...');
    const result = await LocationNotifyService.notifyWaitersForHelperCity(helperCity);
    console.log('Result:', result);
  } else {
    console.log('\nNo helper city — cannot notify.');
  }

  const after = await mongoose.connection
    .collection('location_notify_requests')
    .find({ userId: POSTER_UID })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();
  console.log('\nRequests after trigger:');
  for (const r of after) {
    console.log({ status: r.status, city: r.city, notifiedAt: r.notifiedAt });
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
