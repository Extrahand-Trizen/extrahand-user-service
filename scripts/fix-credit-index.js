/**
 * Fix Credit Transaction Index
 * 
 * Drops the problematic unique index on transactions.transactionId
 * and backfills any missing transactionIds
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function fixCreditIndex() {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment');
    }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Get the actual database name from connection
    const dbName = mongoose.connection.name;
    console.log(`📊 Database: ${dbName}`);

    const db = mongoose.connection.db;
    
    // Check if collection exists
    const collections = await db.listCollections({ name: 'credits' }).toArray();
    const collectionExists = collections.length > 0;
    
    if (!collectionExists) {
      console.log('\n✅ Credits collection does not exist yet - fresh database state');
      console.log('✅ Migration completed - no issues to fix!');
      process.exit(0);
    }

    const creditsCollection = db.collection('credits');

    // Step 1: List existing indexes
    console.log('\n📋 Current indexes on credits collection:');
    const indexes = await creditsCollection.indexes();
    indexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key));
    });

    // Step 2: Drop the problematic unique index if it exists
    try {
      const indexName = 'transactions.transactionId_1';
      console.log(`\n🗑️  Attempting to drop index: ${indexName}`);
      await creditsCollection.dropIndex(indexName);
      console.log(`✅ Successfully dropped index: ${indexName}`);
    } catch (error) {
      if (error.code === 27 || error.message.includes('index not found')) {
        console.log('ℹ️  Index does not exist or already dropped');
      } else {
        console.warn('⚠️  Error dropping index:', error.message);
      }
    }

    // Step 3: Find all credits with null transactionIds
    console.log('\n🔍 Finding credits with null transactionIds...');
    const creditsWithNull = await creditsCollection.find({
      'transactions.transactionId': null
    }).toArray();
    
    console.log(`Found ${creditsWithNull.length} credit documents with null transactionIds`);

    // Step 4: Backfill missing transactionIds
    let updatedCount = 0;
    for (const credit of creditsWithNull) {
      const updates = [];
      
      credit.transactions.forEach((txn, index) => {
        if (!txn.transactionId) {
          const newId = `BACKFILL_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${index}`;
          updates.push({
            index,
            transactionId: newId
          });
        }
      });

      if (updates.length > 0) {
        // Update each transaction with a backfilled ID
        for (const update of updates) {
          await creditsCollection.updateOne(
            { _id: credit._id },
            { 
              $set: { 
                [`transactions.${update.index}.transactionId`]: update.transactionId
              } 
            }
          );
        }
        updatedCount++;
        console.log(`  ✅ Fixed ${updates.length} transactions for credit ${credit._id}`);
      }
    }

    console.log(`\n✅ Backfilled transactionIds for ${updatedCount} credit documents`);

    // Step 5: Create a new sparse, non-unique index
    console.log('\n📊 Creating new sparse, non-unique index on transactions.transactionId...');
    try {
      await creditsCollection.createIndex(
        { 'transactions.transactionId': 1 },
        { sparse: true }
      );
      console.log('✅ Created new sparse, non-unique index');
    } catch (error) {
      console.warn('⚠️  Error creating index:', error.message);
    }

    // Step 6: Verify final state
    console.log('\n📋 Final indexes on credits collection:');
    const finalIndexes = await creditsCollection.indexes();
    finalIndexes.forEach(index => {
      console.log(`  - ${index.name}:`, JSON.stringify(index.key));
    });

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

fixCreditIndex();
