/**
 * One-time migration: backfill Profile.client_type from earliest session token per user.
 * Does not delete any profile data.
 *
 * Strategy:
 * - For profiles missing client_type, read earliest session_tokens entry by createdAt.
 * - Use session clientType when available.
 * - Fallback to "web" when no session exists.
 *
 * Run:
 *   npm run migrate:profile-client-type-from-sessions
 *
 * Requires: MONGODB_URI in `.env`
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "../src/config/database";
import Profile from "../src/models/Profile";

type ClientType = "web" | "mobile";

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI required");
    process.exit(1);
  }

  await connectMongo(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error("No db connection");
    process.exit(1);
  }

  const sessionTokens = db.collection("session_tokens");
  const missingQuery = {
    $or: [
      { client_type: { $exists: false } },
      { client_type: null },
      { client_type: "" },
    ],
  };

  const total = await Profile.countDocuments(missingQuery);
  console.log(`Found ${total} profile(s) missing client_type`);

  let updated = 0;
  let fromMobile = 0;
  let fromWeb = 0;
  let fallbackWeb = 0;

  const cursor = Profile.find(missingQuery).select("_id uid").lean().cursor();
  for await (const profile of cursor as any) {
    const earliestSession = await sessionTokens.findOne(
      { userId: profile.uid },
      {
        sort: { createdAt: 1 },
        projection: { clientType: 1 },
      }
    );

    let clientType: ClientType = "web";
    if (earliestSession?.clientType === "mobile") {
      clientType = "mobile";
      fromMobile += 1;
    } else if (earliestSession?.clientType === "web") {
      fromWeb += 1;
    } else {
      fallbackWeb += 1;
    }

    await Profile.updateOne({ _id: profile._id }, { $set: { client_type: clientType } });
    updated += 1;
  }

  console.log("Backfill complete", {
    total,
    updated,
    fromMobile,
    fromWeb,
    fallbackWeb,
  });

  await disconnectMongo();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

