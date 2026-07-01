const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  const Profile = mongoose.model('Profile', new mongoose.Schema({}, { strict: false }));
  const p = await Profile.findOne({ uid: '3vsCkBGveYdB0Qi2PFYLAlyXYcf1' });
  console.log('Found with exact user screenshot uid (l):', p ? p.uid : 'null');
  
  const p2 = await Profile.findOne({ uid: '3vsCkBGveYdB0Qi2PFYLA1yXYcf1' });
  console.log('Found with 1 instead of l:', p2 ? p2.uid : 'null');
  
  const all = await Profile.find({});
  console.log('All uids in DB:');
  all.forEach(x => console.log(x.uid));
  
  process.exit(0);
}).catch(console.error);
