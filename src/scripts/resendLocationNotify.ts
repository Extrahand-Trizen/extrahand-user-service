/**
 * Reset latest active/notified request for poster and re-send helpers-available notification.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'node:dns';

dns.setServers(['8.8.8.8', '8.8.4.4']);
dotenv.config();
process.env.NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL || 'http://127.0.0.1:4005';

const POSTER_UID = '2QhjF3V4JjPohy1363mjintWm0j2';

async function main() {
  console.log('NOTIFICATION_SERVICE_URL:', process.env.NOTIFICATION_SERVICE_URL);
  await mongoose.connect(process.env.MONGODB_URI!, {
    dbName: process.env.MONGODB_DB || 'extrahand',
  });

  const col = mongoose.connection.collection('location_notify_requests');
  const latest = await col.find({ userId: POSTER_UID }).sort({ createdAt: -1 }).limit(1).next();
  if (!latest) {
    console.log('No notify request found for poster');
    await mongoose.disconnect();
    return;
  }

  await col.updateOne(
    { _id: latest._id },
    { $set: { status: 'active', notifiedAt: null } },
  );
  console.log('Reset request to active:', {
    city: latest.city,
    locality: latest.locality,
  });

  const { LocationNotifyService } = await import('../services/LocationNotifyService');
  const result = await LocationNotifyService.notifyWaitersForHelperCity(String(latest.city));
  console.log('Notify result:', result);

  const after = await col.findOne({ _id: latest._id });
  console.log('After:', { status: after?.status, notifiedAt: after?.notifiedAt });

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
