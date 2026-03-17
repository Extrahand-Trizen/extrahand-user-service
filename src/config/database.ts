import mongoose from 'mongoose';
import logger from './logger';

let isConnected = false;


export async function connectMongo(uri: string): Promise<typeof mongoose.connection> {
  if (!uri) {
    throw new Error('Missing MONGODB_URI');
  }
  
  if (isConnected) {
    return mongoose.connection;
  }
  
  mongoose.set('strictQuery', true);
  
  // Fix malformed URI if detected (common issue with duplicate appName parameter)
  let cleanUri = uri;
  if (uri.includes('appName=Cluster0w=majority')) {
    cleanUri = uri.replace(/appName=Cluster0w=majority&appName=Cluster0/, 'appName=Cluster0');
    logger.warn('⚠️  Detected malformed MongoDB URI, auto-fixing...');
  }
  
  try {
    // Add connection options to handle timeouts better
    const connectionOptions = {
      dbName: process.env.MONGODB_DB || 'extrahand',
      serverSelectionTimeoutMS: 5000, // Fail fast if can't connect in 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      connectTimeoutMS: 10000, // Give up initial connection after 10 seconds
      maxPoolSize: 10, // Maintain up to 10 socket connections
      minPoolSize: 2, // Maintain at least 2 socket connections
    };
    
    logger.info('🔌 Attempting to connect to MongoDB...');
    logger.info(`📊 Database: ${connectionOptions.dbName}`);
    
    await mongoose.connect(cleanUri, connectionOptions);
    
    isConnected = true;
    logger.info('✅ MongoDB connected successfully');
    logger.info(`📊 Connected to database: ${mongoose.connection.db?.databaseName || connectionOptions.dbName}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      logger.error('❌ MongoDB connection error:', err);
      isConnected = false;
    });
    
    mongoose.connection.on('disconnected', () => {
      logger.warn('⚠️ MongoDB disconnected');
      isConnected = false;
    });
    
    mongoose.connection.on('reconnected', () => {
      logger.info('✅ MongoDB reconnected');
      isConnected = true;
    });
    
    return mongoose.connection;
  } catch (error) {
    logger.error('❌ Failed to connect to MongoDB:', error);
    isConnected = false;
    throw error;
  }
}

export async function disconnectMongo(): Promise<void> {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('✅ MongoDB disconnected');
  }
}

export function getConnectionStatus(): boolean {
  const readyState = mongoose.connection.readyState;
  const connected = isConnected && readyState === 1;
  
  // Log connection state for debugging
  if (!connected && readyState !== 0) {
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
    logger.warn(`⚠️ MongoDB connection state: ${states[readyState] || 'unknown'} (${readyState})`);
  }
  
  return connected;
}
