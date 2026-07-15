/**
 * debug-tasker-locations.js
 * Shows what location data taskers actually have stored in MongoDB.
 * Run: node debug-tasker-locations.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const Profile = mongoose.model(
  'Profile',
  new mongoose.Schema({}, { strict: false, collection: 'profiles' }),
);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅ Connected —', mongoose.connection.db.databaseName);
  console.log('');

  // ── 1. All cities taskers have stored ──────────────────────────────────────
  const cityGroups = await Profile.aggregate([
    {
      $match: {
        roles: { $in: ['tasker'] },
        isActive: true,
        'dataPrivacy.accountDeleted': { $ne: true },
      },
    },
    {
      $group: {
        _id: {
          $ifNull: [
            '$location.addressDetails.city',
            { $ifNull: ['$location.city', '(no city)'] },
          ],
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  console.log('📊 All cities stored on tasker profiles:');
  cityGroups.forEach((g) => console.log(`   "${g._id}" — ${g.count} tasker(s)`));
  console.log('');

  // ── 2. Sample of taskers with NO city — what DO they have? ─────────────────
  const noCity = await Profile.find(
    {
      roles: { $in: ['tasker'] },
      isActive: true,
      'dataPrivacy.accountDeleted': { $ne: true },
      'location.addressDetails.city': { $in: [null, '', undefined] },
      'location.city': { $in: [null, '', undefined] },
    },
    {
      name: 1,
      'location.address': 1,
      'location.addressDetails': 1,
      'location.city': 1,
      'location.coordinates': 1,
    },
  )
    .limit(10)
    .lean();

  console.log('🔎 Sample of taskers with NO city field (first 10):');
  noCity.forEach((t, i) => {
    console.log(`\n   ${i + 1}. ${t.name || 'Unknown'}`);
    console.log(`      location.city       : "${t.location?.city || ''}"`);
    console.log(`      addressDetails.city : "${t.location?.addressDetails?.city || ''}"`);
    console.log(`      addressDetails.area : "${t.location?.addressDetails?.area || ''}"`);
    console.log(`      location.address    : "${(t.location?.address || '').substring(0, 80)}"`);
    console.log(`      coordinates         : ${JSON.stringify(t.location?.coordinates || [])}`);
  });

  console.log('');

  // ── 3. Check your specific profile (poster in Odisha) ─────────────────────
  console.log('🔎 Checking poster profile with Odisha location...');
  const odishaPosters = await Profile.find(
    {
      $or: [
        { 'location.addressDetails.city': /odisha/i },
        { 'location.city': /odisha/i },
        { 'location.address': /odisha/i },
        { 'location.addressDetails.state': /odisha/i },
      ],
    },
    {
      name: 1,
      roles: 1,
      'location.address': 1,
      'location.addressDetails': 1,
      'location.city': 1,
    },
  )
    .limit(5)
    .lean();

  if (odishaPosters.length === 0) {
    console.log('   No profiles found with "Odisha" anywhere in location.');
  } else {
    odishaPosters.forEach((p) => {
      console.log(`\n   ${p.name} (roles: ${JSON.stringify(p.roles)})`);
      console.log(`      location.city       : "${p.location?.city || ''}"`);
      console.log(`      addressDetails.city : "${p.location?.addressDetails?.city || ''}"`);
      console.log(`      addressDetails.state: "${p.location?.addressDetails?.state || ''}"`);
      console.log(`      location.address    : "${(p.location?.address || '').substring(0, 80)}"`);
    });
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
