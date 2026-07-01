const mongoose = require('mongoose');
const { Schema } = mongoose;

mongoose.connect('mongodb://localhost:27017/extrahand', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  const Profile = mongoose.model('Profile', new Schema({}, { strict: false }));
  const profiles = await Profile.find({});
  console.log('Total profiles:', profiles.length);
  for (const p of profiles) {
    console.log('Profile:', p.uid, p.name, 'Roles:', p.roles);
  }
  process.exit(0);
}).catch(console.error);
