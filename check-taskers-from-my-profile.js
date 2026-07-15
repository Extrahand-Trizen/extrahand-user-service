/**
 * Load YOUR profile location from MongoDB (by Firebase uid) and count taskers in that city.
 * Matches mobile app city logic (normalizeProfileLocationParts + city match).
 *
 * Usage:
 *   node check-taskers-from-my-profile.js --uid YOUR_FIREBASE_UID
 *   node check-taskers-from-my-profile.js --uid WJi4jVJcA5cvwUYCpwgczlug4Nh2
 *   node check-taskers-from-my-profile.js --uid YOUR_UID --verbose
 *
 * Optional — same as app API (needs access token while logged in):
 *   set ACCESS_TOKEN=your_jwt_from_app
 *   set GATEWAY_URL=https://extrahand-api-gateway.apps.extrahand.in
 *   node check-taskers-from-my-profile.js --api
 *
 * Find your uid: CapRover logs show uid on GET /profiles/me, or Mongo profiles.uid
 */

require('dotenv').config();
const mongoose = require('mongoose');
const https = require('https');
const http = require('http');

const args = process.argv.slice(2);
const uidIdx = args.indexOf('--uid');
const UID = uidIdx !== -1 ? String(args[uidIdx + 1] || '').trim() : String(process.env.MY_UID || '').trim();
const VERBOSE = args.includes('--verbose') || args.includes('-v');
const USE_API = args.includes('--api');
const GATEWAY_URL = (process.env.GATEWAY_URL || 'https://extrahand-api-gateway.apps.extrahand.in').replace(/\/$/, '');
const ACCESS_TOKEN = String(process.env.ACCESS_TOKEN || '').trim();

const INDIAN_PIN_RE = /^\d{6}$/;

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCityFromAddress(addr) {
  const parts = String(addr || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';

  const nonPlusCode = parts.filter((p) => !p.includes('+'));
  const tokens = nonPlusCode.length > 0 ? nonPlusCode : parts;

  if (tokens.length >= 3) return tokens[tokens.length - 3] || '';
  if (tokens.length >= 2) return tokens[tokens.length - 2] || tokens[0] || '';
  return tokens[0] || '';
}

function normalizeProfileLocationParts(location) {
  const loc = location || {};
  let city =
    String(loc.addressDetails?.city || '').trim() ||
    String(loc.city || '').trim();
  let pinCode =
    String(loc.addressDetails?.pinCode || '').trim() ||
    String(loc.pinCode || '').trim();

  if (city && INDIAN_PIN_RE.test(city)) {
    if (!pinCode) pinCode = city;
    city = '';
  }

  if (pinCode && !INDIAN_PIN_RE.test(pinCode) && !city) {
    city = pinCode;
    pinCode = '';
  }

  const address = String(loc.address || '').trim();
  if (!city) {
    const doorNo = String(loc.addressDetails?.doorNo || '').trim();
    city =
      extractCityFromAddress(address) ||
      (doorNo && !INDIAN_PIN_RE.test(doorNo) ? doorNo : '') ||
      String(loc.addressDetails?.area || '').trim();
  }

  if (city && INDIAN_PIN_RE.test(city)) {
    if (!pinCode) pinCode = city;
    city = extractCityFromAddress(address) || '';
  }

  return { city: city.trim(), pinCode: pinCode.trim() };
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      parsed,
      {
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const json = data ? JSON.parse(data) : {};
            resolve({ status: res.statusCode, json, raw: data });
          } catch {
            resolve({ status: res.statusCode, json: null, raw: data });
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function fetchProfileViaApi() {
  if (!ACCESS_TOKEN) {
    throw new Error('Set ACCESS_TOKEN (JWT from logged-in app) for --api mode');
  }
  const res = await httpRequest(`${GATEWAY_URL}/api/v1/profiles/me`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (res.status !== 200) {
    throw new Error(`GET /profiles/me failed: HTTP ${res.status} ${res.raw?.slice(0, 200)}`);
  }
  const profile = res.json?.profile || res.json?.data || res.json;
  return profile;
}

async function fetchNearbyHelpersViaApi(city, limit = 50) {
  if (!ACCESS_TOKEN) throw new Error('ACCESS_TOKEN required');
  const qs = new URLSearchParams({ city, limit: String(limit) });
  const res = await httpRequest(`${GATEWAY_URL}/api/v1/profiles/nearby-helpers?${qs}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (res.status !== 200) {
    throw new Error(`nearby-helpers failed: HTTP ${res.status} ${res.raw?.slice(0, 200)}`);
  }
  const payload = res.json?.data || res.json;
  return payload;
}

const ProfileSchema = new mongoose.Schema({}, { strict: false, collection: 'profiles' });
const Profile = mongoose.models.Profile || mongoose.model('Profile', ProfileSchema);

async function countTaskersInCity(city, excludeUid) {
  const cityRe = new RegExp(`^${escapeRegExp(city)}$`, 'i');
  const cityContainsRe = new RegExp(escapeRegExp(city), 'i');

  const baseFilter = {
    roles: { $in: ['tasker'] },
    isActive: true,
    'dataPrivacy.accountDeleted': { $ne: true },
    ...(excludeUid ? { uid: { $ne: excludeUid } } : {}),
  };

  const cityMatchFilter = {
    ...baseFilter,
    $or: [
      { 'location.addressDetails.city': cityRe },
      { 'location.city': cityRe },
      { 'location.address': cityContainsRe },
    ],
  };

  const count = await Profile.countDocuments(cityMatchFilter);
  const sample = await Profile.find(cityMatchFilter, {
    uid: 1,
    name: 1,
    'location.addressDetails.city': 1,
    'location.city': 1,
  })
    .limit(20)
    .lean();

  return { count, sample, baseFilter };
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📍  Taskers in MY profile city');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let profile;
  let excludeUid = UID;

  if (USE_API) {
    console.log(`🌐 API mode — ${GATEWAY_URL}`);
    profile = await fetchProfileViaApi();
    excludeUid = profile?.uid || excludeUid;
  } else {
    if (!UID) {
      console.error('❌ Pass --uid YOUR_FIREBASE_UID (or set MY_UID in .env)');
      console.error('   Example: node check-taskers-from-my-profile.js --uid abc123');
      process.exit(1);
    }
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('❌ MONGODB_URI not set in .env');
      process.exit(1);
    }
    console.log(`🔌 MongoDB — loading profile uid=${UID}`);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    profile = await Profile.findOne({ uid: UID }).lean();
    if (!profile) {
      console.error(`❌ No profile found for uid=${UID}`);
      await mongoose.disconnect();
      process.exit(1);
    }
  }

  const { city, pinCode } = normalizeProfileLocationParts(profile.location);
  const coords = profile.location?.coordinates;
  const lat = Array.isArray(coords) && coords.length >= 2 ? coords[1] : null;
  const lng = Array.isArray(coords) && coords.length >= 2 ? coords[0] : null;

  console.log('');
  console.log('👤 Your profile');
  console.log(`   uid     : ${profile.uid}`);
  console.log(`   name    : ${profile.name || '(no name)'}`);
  console.log(`   roles   : ${JSON.stringify(profile.roles || [])}`);
  console.log(`   city    : ${city || '(empty — home may show no helpers)'}`);
  console.log(`   pinCode : ${pinCode || '(none)'}`);
  if (VERBOSE) {
    console.log(`   address : ${(profile.location?.address || '').slice(0, 100)}`);
    console.log(`   area    : ${profile.location?.addressDetails?.area || ''}`);
    console.log(`   state   : ${profile.location?.addressDetails?.state || ''}`);
    console.log(`   coords  : ${lat != null && lng != null ? `${lat}, ${lng}` : '(none)'}`);
  }

  if (!city) {
    console.log('');
    console.error('❌ Could not resolve a city from your profile location.');
    console.error('   Update location in the app (not pin-only), then re-run.');
    if (mongoose.connection.readyState === 1) await mongoose.disconnect();
    process.exit(1);
  }

  console.log('');
  console.log(`🔍 Counting taskers in city: "${city}" (excluding you if tasker)`);

  if (USE_API) {
    const apiResult = await fetchNearbyHelpersViaApi(city, 50);
    console.log('');
    console.log('━━ API (gateway nearby-helpers) ━━');
    console.log(`   count       : ${apiResult.count}`);
    console.log(`   hasHelpers  : ${apiResult.hasHelpers ? '✅ YES' : '❌ NO'}`);
    if (VERBOSE && apiResult.helpers?.length) {
      apiResult.helpers.slice(0, 10).forEach((h, i) => {
        console.log(`   ${i + 1}. ${h.name} (${h.uid}) — ${h.location?.city || ''}`);
      });
    }
  }

  if (mongoose.connection.readyState !== 1 && process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  }

  if (mongoose.connection.readyState === 1) {
    const { count, sample } = await countTaskersInCity(city, excludeUid);
    const totalTaskers = await Profile.countDocuments({
      roles: { $in: ['tasker'] },
      isActive: true,
      'dataPrivacy.accountDeleted': { $ne: true },
    });

    console.log('');
    console.log('━━ MongoDB (direct count) ━━');
    console.log(`   total active taskers : ${totalTaskers}`);
    console.log(`   in your city         : ${count}`);
    console.log(`   has helpers          : ${count > 0 ? '✅ YES' : '❌ NO'}`);

    if (count > 0 && VERBOSE) {
      console.log('');
      console.log('   Sample taskers:');
      sample.forEach((t, i) => {
        const stored =
          t.location?.addressDetails?.city || t.location?.city || '(no city)';
        console.log(`   ${i + 1}. ${t.name} — city: ${stored}`);
      });
    }
    await mongoose.disconnect();
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch((err) => {
  console.error('❌', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
