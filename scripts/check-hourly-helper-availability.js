require('dotenv').config();
const mongoose = require('mongoose');

const target = { lat: 18.573303333333335, lng: 83.362345 };
const requiredCategories = new Set([
  'home-services',
  'home-cleaning',
  'house-cleaning',
  'cleaning',
  'full-house',
  'handyman',
]);

function distanceKm(lat, lng) {
  const radius = 6371;
  const radians = Math.PI / 180;
  const a =
    Math.sin((lat - target.lat) * radians / 2) ** 2 +
    Math.cos(target.lat * radians) *
      Math.cos(lat * radians) *
      Math.sin((lng - target.lng) * radians / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

function normalizeCategory(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const profiles = await mongoose.connection.db
    .collection('profiles')
    .find({
      isActive: true,
      'partnerProfile.status': 'approved',
      roles: { $in: ['tasker', 'both', 'helper'] },
    })
    .project({ name: 1, uid: 1, location: 1, partnerProfile: 1, helperWorkAreas: 1 })
    .toArray();

  const partners = profiles
    .map((profile) => {
      const coordinates = profile.location?.coordinates;
      const lng = Array.isArray(coordinates) ? Number(coordinates[0]) : NaN;
      const lat = Array.isArray(coordinates) ? Number(coordinates[1]) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      const categories = Array.isArray(profile.partnerProfile?.categories)
        ? profile.partnerProfile.categories
        : [];
      const normalizedCategories = categories.map(normalizeCategory);
      return {
        name: profile.name || 'Helper',
        uid: profile.uid,
        distanceKm: Number(distanceKm(lat, lng).toFixed(2)),
        categories,
        homeServicesSkill: normalizedCategories.some((category) =>
          requiredCategories.has(category),
        ),
        workAreas:
          profile.partnerProfile?.workAreas || profile.helperWorkAreas || [],
      };
    })
    .filter((partner) => partner && partner.distanceKm <= 50)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  console.log(
    JSON.stringify(
      {
        profileLocation: target,
        radiusKm: 50,
        activeApprovedPartners: partners.length,
        matchingHomeServicesPartners: partners.filter(
          (partner) => partner.homeServicesSkill,
        ).length,
        partners,
      },
      null,
      2,
    ),
  );
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error('Hourly availability diagnostic failed:', error.message);
  process.exitCode = 1;
});
