import { Router } from "express";
import authRoutes from "./auth";
import profileRoutes from "./profiles";
import userRoutes from "./users";
import businessRoutes from "./business";
import privacyRoutes from "./privacy";
import uploadRoutes from "./uploads";
import sessionRoutes from "./sessions";
import verificationRoutes from "./verification";
import notificationPreferencesRoutes from "./notificationPreferences";
import referralRoutes from "./referral";
import badgeRoutes from "./badge";
import inquiriesRoutes from "./inquiries";
import { gatewayAuthMiddleware } from "../middleware/gatewayAuth";

const router = Router();

// Health check
router.get("/health", (_req, res) => {
   res.json({
      success: true,
      service: "extrahand-user-service",
      status: "healthy",
      timestamp: new Date().toISOString(),
   });
});

// Gateway auth middleware (requires all requests to come through gateway)
router.use(gatewayAuthMiddleware);

// API routes
router.use("/auth", authRoutes);
router.use("/profiles", profileRoutes);
router.use("/users", userRoutes);
router.use("/business", businessRoutes);
router.use("/privacy", privacyRoutes);
router.use("/uploads", uploadRoutes);
router.use("/sessions", sessionRoutes);
router.use("/verification", verificationRoutes);
router.use("/notification-preferences", notificationPreferencesRoutes);
router.use("/user", referralRoutes);
router.use("/user", badgeRoutes);
router.use("/inquiries", inquiriesRoutes);

export default router;
