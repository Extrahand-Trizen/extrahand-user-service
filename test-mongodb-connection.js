// Quick MongoDB connection test
require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('❌ MONGODB_URI not found in .env');
  process.exit(1);
}

console.log('🔌 Testing MongoDB connection...');
console.log('📊 URI:', uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')); // Hide credentials

// Fix malformed URI if needed
let cleanUri = uri;
if (uri.includes('appName=Cluster0w=majority')) {
  cleanUri = uri.replace(/appName=Cluster0w=majority&appName=Cluster0/, 'appName=Cluster0');
  console.log('⚠️  Detected malformed URI, attempting to fix...');
  console.log('📊 Cleaned URI:', cleanUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
}

const connectionOptions = {
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  connectTimeoutMS: 10000,
};

mongoose.connect(cleanUri, connectionOptions)
  .then(() => {
    console.log('✅ MongoDB connection successful!');
    console.log('📊 Database:', mongoose.connection.db?.databaseName);
    console.log('📊 ReadyState:', mongoose.connection.readyState);
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ MongoDB connection failed:');
    console.error('📊 Error name:', error.name);
    console.error('📊 Error message:', error.message);
    if (error.message.includes('authentication')) {
      console.error('💡 Check: Username/password might be incorrect');
    }
    if (error.message.includes('timeout') || error.message.includes('ENOTFOUND')) {
      console.error('💡 Check: Network connectivity or MongoDB Atlas IP whitelist');
    }
    process.exit(1);
  });

