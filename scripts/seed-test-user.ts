/**
 * Seed script: creates LOCAL_TEST dummy users in Firebase and MongoDB.
 * Run: npm run seed (from extrahand-user-service)
 *
 * Fixed credentials (no env):
 *   - Phone +91 9876543210, OTP 123456
 *   - Phone +91 1234567890, OTP 654321
 * Set LOCAL_TEST=true in .env to allow dummy signin/signup.
 *
 * Requires: MONGODB_URI, Firebase credentials (same as user-service).
 */

import dotenv from "dotenv";
dotenv.config();

import { connectMongo, disconnectMongo } from "../src/config/database";
import { auth } from "../src/config/firebase";
import Profile from "../src/models/Profile";

const DEV_DUMMY_USERS: Array<{ phoneE164: string; otp: string; name: string }> = [
   { phoneE164: "+919876543210", otp: "123456", name: "Local Test User" },
   { phoneE164: "+911234567890", otp: "654321", name: "Local Test User 2" },
];

async function ensureDevUser(phoneE164: string, displayName: string): Promise<string> {
   let uid = "";
   try {
      const userRecord = await auth.createUser({
         phoneNumber: phoneE164,
         displayName,
      });
      uid = userRecord.uid;
      console.log("✅ Firebase test user created:", uid, phoneE164);
   } catch (err: any) {
      if (err?.code === "auth/phone-number-already-exists") {
         let found = false;
         let pageToken: string | undefined;
         do {
            const listResult = await auth.listUsers(1000, pageToken);
            const byPhone = listResult.users.find((u) => u.phoneNumber === phoneE164);
            if (byPhone) {
               uid = byPhone.uid;
               found = true;
               break;
            }
            pageToken = listResult.pageToken;
         } while (pageToken);
         if (!found) {
            const existingProfile = await Profile.findOne({ phone: phoneE164 }).lean();
            if (existingProfile?.uid) {
               uid = existingProfile.uid;
            } else {
               throw new Error(
                  "Firebase user exists but could not get UID. Run seed once without existing user."
               );
            }
         }
         console.log("✅ Firebase test user already exists:", uid, phoneE164);
      } else {
         throw err;
      }
   }
   if (!uid) throw new Error("Could not resolve Firebase UID for " + phoneE164);
   return uid;
}

async function ensureProfile(uid: string, phoneE164: string, name: string): Promise<void> {
   let profile: any = await Profile.findOne({ uid }).lean();
   if (profile) {
      console.log("✅ MongoDB profile already exists for uid:", uid);
      if (profile.phone !== phoneE164) {
         await Profile.updateOne({ uid }, { $set: { phone: phoneE164 } });
         console.log("✅ Updated profile phone to:", phoneE164);
      }
   } else {
      await Profile.create({
         uid,
         name,
         phone: phoneE164,
         roles: [],
         userType: "individual",
         rating: 0,
         totalReviews: 0,
         totalTasks: 0,
         completedTasks: 0,
         isVerified: false,
         isAadhaarVerified: false,
         isActive: true,
         agreeUpdates: false,
         agreeTerms: false,
      });
      console.log("✅ MongoDB profile created for uid:", uid);
   }
}

async function seedTestUser() {
   const mongoUri = process.env.MONGODB_URI;
   if (!mongoUri) {
      console.error("❌ MONGODB_URI is required. Set it in .env");
      process.exit(1);
   }

   try {
      await connectMongo(mongoUri);

      for (const u of DEV_DUMMY_USERS) {
         const uid = await ensureDevUser(u.phoneE164, u.name);
         await ensureProfile(uid, u.phoneE164, u.name);
      }

      console.log("\n📋 LOCAL_TEST credentials:");
      for (const u of DEV_DUMMY_USERS) {
         console.log("   Phone:", u.phoneE164, "| OTP:", u.otp);
      }
      console.log("   Set LOCAL_TEST=true in .env (user-service and api-gateway).");
   } catch (error: any) {
      console.error("❌ Seed failed:", error?.message || error);
      process.exit(1);
   } finally {
      await disconnectMongo();
      process.exit(0);
   }
}

seedTestUser();
