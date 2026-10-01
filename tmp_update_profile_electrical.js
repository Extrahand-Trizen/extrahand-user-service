const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB || 'extrahand' });
  const db = mongoose.connection.db;

  const uid = '1Ac3f3DFTnXb8BJGT4tZg1OX3TZ2';
  const phone = '9999999999';

  const query = {
    $or: [
      { uid },
      { phone },
      { phone: '+91' + phone },
      { phone: '91' + phone },
      { phone: phone.replace(/^91/, '') },
    ],
  };

  const matches = await db.collection('profiles').find(query).toArray();
  console.log('MATCH_COUNT', matches.length);

  const target = matches.find((d) => d.uid === uid) || matches[0];
  if (!target) {
    console.log('NO_RECORD_FOUND');
    await mongoose.disconnect();
    return;
  }

  const name = 'fan installation';
  const list = Array.isArray(target.skills && target.skills.list) ? target.skills.list : [];
  const existingSkill = list.find((s) => {
    const skillName = String(s && s.name || '').toLowerCase();
    const category = String(s && s.category || '').toLowerCase();
    return category === 'electrical' || skillName.includes('fan') || skillName.includes('electrical');
  });

  const update = existingSkill
    ? {
        $set: {
          'skills.primaryCategory': 'electrical',
          'skills.updatedAt': new Date(),
        },
      }
    : {
        $set: {
          'skills.primaryCategory': 'electrical',
          'skills.updatedAt': new Date(),
        },
        $addToSet: {
          'skills.list': {
            name,
            category: 'electrical',
            certified: false,
            verified: false,
          },
        },
      };

  const result = await db.collection('profiles').updateOne({ _id: target._id }, update);
  console.log('UPDATE_RESULT', JSON.stringify({
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    acknowledged: result.acknowledged,
  }, null, 2));

  const after = await db.collection('profiles').findOne({ _id: target._id });
  console.log('AFTER', JSON.stringify({
    uid: after && after.uid,
    phone: after && after.phone,
    primaryCategory: after && after.skills && after.skills.primaryCategory,
    matchingSkills: after && after.skills && Array.isArray(after.skills.list)
      ? after.skills.list.filter((s) => {
          const skillName = String(s && s.name || '').toLowerCase();
          const category = String(s && s.category || '').toLowerCase();
          return category === 'electrical' || skillName.includes('fan') || skillName.includes('electrical');
        })
      : []
  }, null, 2));

  await mongoose.disconnect();
})();
