import { Router } from "express";
import authRoutes from "./auth";
import profileRoutes from "./profiles";
import businessRoutes from "./business";
import privacyRoutes from "./privacy";
import uploadRoutes from "./uploads";
import sessionRoutes from "./sessions";
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
router.use("/business", businessRoutes);
router.use("/privacy", privacyRoutes);
router.use("/uploads", uploadRoutes);
router.use("/sessions", sessionRoutes);

export default router;
