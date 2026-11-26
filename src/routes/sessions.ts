import { Router } from "express";
import { SessionController } from "../controllers/SessionController";
import { asyncHandler } from "../middleware/errorHandler";
import { serviceAuthMiddleware } from "../middleware/serviceAuth";

const router = Router();

router.post("/validate", serviceAuthMiddleware, asyncHandler(SessionController.validate));
router.post("/refresh", asyncHandler(SessionController.refresh));
router.post("/logout", asyncHandler(SessionController.logout));

export default router;
