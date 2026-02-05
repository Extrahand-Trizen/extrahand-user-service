/**
 * Seed script: creates the LOCAL_TEST dummy user in Firebase and MongoDB.
 * Run: npm run seed (from extrahand-user-service)
 *
 * Fixed credentials (no env): Phone +91 9876543210, OTP 123456.
 * Set LOCAL_TEST=true in .env to allow dummy signin/signup.
 *
 * Requires: MONGODB_URI, Firebase credentials (same as user-service).
 */

import dotenv from "dotenv";
dotenv.config();

import { connectMongo, disconnectMongo } from "../src/config/database";
import { auth } from "../src/config/firebase";
import Profile from "../src/models/Profile";

const DUMMY_PHONE_E164 = "+919876543210";
const DUMMY_OTP = "123456";
const DUMMY_NAME = "Local Test User";

async function seedTestUser() {
   const mongoUri = process.env.MONGODB_URI;
   if (!mongoUri) {
      console.error("❌ MONGODB_URI is required. Set it in .env");
      process.exit(1);
   }

   try {
      await connectMongo(mongoUri);

      let uid: string;
      try {
         const userRecord = await auth.createUser({
            phoneNumber: DUMMY_PHONE_E164,
            displayName: DUMMY_NAME,
         });
         uid = userRecord.uid;
         console.log("✅ Firebase test user created:", uid);
      } catch (err: any) {
         if (err?.code === "auth/phone-number-already-exists") {
            let found = false;
            let pageToken: string | undefined;
            do {
               const listResult = await auth.listUsers(1000, pageToken);
               const byPhone = listResult.users.find(
                  (u) => u.phoneNumber === DUMMY_PHONE_E164
               );
               if (byPhone) {
                  uid = byPhone.uid;
                  found = true;
                  break;
               }
               pageToken = listResult.pageToken;
            } while (pageToken);
            if (!found) {
               const existingProfile = await Profile.findOne({
                  phone: DUMMY_PHONE_E164,
               }).lean();
               if (existingProfile?.uid) {
                  uid = existingProfile.uid;
               } else {
                  throw new Error(
                     "Firebase user exists but could not get UID. Run seed once without existing user."
                  );
               }
            }
            console.log("✅ Firebase test user already exists:", uid);
         } else {
            throw err;
         }
      }

      let profile: any = await Profile.findOne({ uid }).lean();
      if (profile) {
         console.log("✅ MongoDB profile already exists for uid:", uid);
         if (profile.phone !== DUMMY_PHONE_E164) {
            await Profile.updateOne(
               { uid },
               { $set: { phone: DUMMY_PHONE_E164 } }
            );
            console.log("✅ Updated profile phone to:", DUMMY_PHONE_E164);
         }
      } else {
         await Profile.create({
            uid,
            name: DUMMY_NAME,
            phone: DUMMY_PHONE_E164,
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

      console.log("\n📋 LOCAL_TEST credentials:");
      console.log("   Phone:", DUMMY_PHONE_E164);
      console.log("   OTP:", DUMMY_OTP);
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
