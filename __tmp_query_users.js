const mongoose = require('mongoose');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

mongoose.connect(uri)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    const profileCol = mongoose.connection.db.collection('profiles');
    const abdul = await profileCol.findOne({ uid: 'uTGcRsEHyyXPh4vfU6kNexshXiH2' });
    console.log('=== ABDUL PROFILE ===');
    console.log(JSON.stringify(abdul, null, 2));
    
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
