/**
 * check-taskers-by-location.js
 *
 * Detects your current city (via IP geolocation) then queries MongoDB
 * for all active taskers whose saved location matches that city.
 *
 * Usage:
 *   node check-taskers-by-location.js
 *   node check-taskers-by-location.js --city "Hyderabad"
 *   node check-taskers-by-location.js --city "Delhi" --verbose
 */

require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cityArgIdx = args.indexOf('--city');
const FORCED_CITY = cityArgIdx !== -1 ? args[cityArgIdx + 1] : null;
const VERBOSE = args.includes('--verbose') || args.includes('-v');

// ── Helpers ─────────────────────────────────────────────────────────────────
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Failed to parse JSON from ' + url)); }
      });
    }).on('error', reject);
  });
}

async function detectCityFromIP() {
  // Try multiple free IP-geolocation APIs in order
  const apis = [
    { url: 'https://ipapi.co/json/', cityField: 'city' },
    { url: 'https://ip-api.com/json/', cityField: 'city' },
    { url: 'https://ipwho.is/', cityField: 'city' },
  ];

  for (const api of apis) {
    try {
      const data = await httpsGet(api.url);
      const city = data[api.cityField]?.trim();
      if (city) {
        console.log(`📍 Detected location via ${api.url}`);
        console.log(`   IP       : ${data.ip || data.query || 'unknown'}`);
        console.log(`   City     : ${city}`);
        console.log(`   Region   : ${data.region || data.regionName || ''}`);
        console.log(`   Country  : ${data.country_name || data.country || ''}`);
        return city;
      }
    } catch (err) {
      if (VERBOSE) console.warn(`   ⚠️  ${api.url} failed: ${err.message}`);
    }
  }
  throw new Error('Could not detect city from IP. Use --city "YourCity" to specify manually.');
}

// ── Minimal Profile schema (read-only) ──────────────────────────────────────
const ProfileSchema = new mongoose.Schema({}, { strict: false, collection: 'profiles' });
const Profile = mongoose.models.Profile || mongoose.model('Profile', ProfileSchema);

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍  Tasker Availability Checker');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Resolve city
  let city;
  if (FORCED_CITY) {
    city = FORCED_CITY.trim();
    console.log(`📍 Using manually specified city: "${city}"`);
  } else {
    console.log('🌐 Detecting your current city from IP address...');
    city = await detectCityFromIP();
  }

  console.log('');

  // 2. Connect to MongoDB
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set in .env');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
  });
  console.log(`✅ Connected — DB: ${mongoose.connection.db.databaseName}`);
  console.log('');

  // 3. Build city regex — case-insensitive exact match
  const cityRe = new RegExp(`^${escapeRegExp(city)}$`, 'i');
  const cityContainsRe = new RegExp(escapeRegExp(city), 'i');

  const baseFilter = {
    roles: { $in: ['tasker'] },
    isActive: true,
    'dataPrivacy.accountDeleted': { $ne: true },
  };

  // 4. Count taskers matching the city
  const cityMatchFilter = {
    ...baseFilter,
    $or: [
      { 'location.addressDetails.city': cityRe },
      { 'location.city': cityRe },
      { 'location.address': cityContainsRe },
    ],
  };

  const matchedCount = await Profile.countDocuments(cityMatchFilter);
  const totalTaskers = await Profile.countDocuments(baseFilter);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊  Results for city: "${city}"`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Total taskers in DB          : ${totalTaskers}`);
  console.log(`   Taskers matching "${city}"   : ${matchedCount}`);
  console.log(`   Has helpers in your area     : ${matchedCount > 0 ? '✅ YES' : '❌ NO'}`);
  console.log('');

  // 5. Show matched taskers (up to 20)
  if (matchedCount > 0) {
    const taskers = await Profile.find(cityMatchFilter, {
      _id: 1,
      uid: 1,
      name: 1,
      'location.addressDetails': 1,
      'location.city': 1,
      'location.address': 1,
      roles: 1,
    }).limit(20).lean();

    console.log(`👥  Matched taskers (showing up to 20):`);
    taskers.forEach((t, i) => {
      const storedCity =
        t.location?.addressDetails?.city ||
        t.location?.city ||
        '(no city field)';
      const address = t.location?.address
        ? t.location.address.substring(0, 60) + (t.location.address.length > 60 ? '…' : '')
        : '(no address)';
      console.log(`   ${i + 1}. ${t.name || 'Unknown'}`);
      console.log(`      uid          : ${t.uid}`);
      console.log(`      stored city  : ${storedCity}`);
      if (VERBOSE) {
        console.log(`      address      : ${address}`);
        console.log(`      roles        : ${JSON.stringify(t.roles)}`);
      }
    });
  } else {
    // 6. Debug: show what cities taskers ARE in
    console.log('🔎  No taskers found in your city. Checking what cities taskers ARE in...');
    const cityGroups = await Profile.aggregate([
      { $match: baseFilter },
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
      { $limit: 15 },
    ]);

    if (cityGroups.length === 0) {
      console.log('   ⚠️  No active taskers found in the database at all.');
    } else {
      console.log('   Cities with taskers:');
      cityGroups.forEach((g) => {
        console.log(`      "${g._id}" — ${g.count} tasker(s)`);
      });
      console.log('');
      console.log(`   💡 Your detected city "${city}" did not match any of the above.`);
      console.log(`      Try: node check-taskers-by-location.js --city "ExactCityName"`);
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Script failed:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
