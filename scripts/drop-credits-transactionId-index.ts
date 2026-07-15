/**
 * One-time migration: drop the old unique index on credits.transactions.transactionId
 * so the app can use a sparse unique index instead (allowing multiple null transactionIds
 * from legacy data and fixing E11000 on referral-dashboard).
 *
 * Run once before or after deploying the Credit model change:
 *   npx ts-node -r tsconfig-paths/register scripts/drop-credits-transactionId-index.ts
 *
 * Requires: MONGODB_URI (and MONGODB_DB if not default 'extrahand') in .env
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../src/config/database';

const INDEX_NAME = 'transactions.transactionId_1';
const COLLECTION = 'credits';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI required');
    process.exit(1);
  }

  await connectMongo(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error('No db');
    process.exit(1);
  }

  const collection = db.collection(COLLECTION);
  const indexes = await collection.indexes();
  const hasIndex = indexes.some((idx) => idx.name === INDEX_NAME);

  if (!hasIndex) {
    console.log(`Index ${INDEX_NAME} not found (already dropped or never created). Done.`);
    await disconnectMongo();
    process.exit(0);
    return;
  }

  await collection.dropIndex(INDEX_NAME);
  console.log(`Dropped index ${INDEX_NAME} on ${COLLECTION}.`);
  await disconnectMongo();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
