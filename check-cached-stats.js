const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });

async function checkCachedStats() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/extrahand-user-service');
    const db = mongoose.connection;
    
    const profilesCollection = db.collection('profiles');
    const profiles = await profilesCollection.find({
      $or: [
        { completedTasks: { $exists: true, $gt: 0 } },
        { totalTasks: { $exists: true, $gt: 0 } }
      ]
    }).toArray();
    
    console.log(`Found ${profiles.length} profiles with cached task counts`);
    
    if (profiles.length > 0) {
      console.log('\n📝 Profiles with cached task data:');
      profiles.forEach((profile, idx) => {
        console.log(`  ${idx + 1}. ${profile.uid} - totalTasks: ${profile.totalTasks}, completedTasks: ${profile.completedTasks}`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkCachedStats();
