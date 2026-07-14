require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  console.log('uri', (process.env.MONGODB_URI || '').slice(0, 40));
  await mongoose.connect(process.env.MONGODB_URI);
  const p = await mongoose.connection.db.collection('profiles').findOne(
    { uid: '4ccQzyJRTZXhljXnyIeca2Kt2Fg2' },
    { projection: { name:1, roles:1, registrationStatus:1, onboardingStatus:1, location:1, partnerProfile:1, skills:1, helperWorkAreas:1, phone:1 } }
  );
  console.log('FOUND', !!p);
  console.log(JSON.stringify(p, null, 2));
  await mongoose.disconnect();
})().catch(e => { console.error('ERR', e); process.exit(1); });
