import { Router } from "express";
import { SessionController } from "../controllers/SessionController";
import { asyncHandler } from "../middleware/errorHandler";

const router = Router();

router.post("/refresh", asyncHandler(SessionController.refresh));
router.post("/logout", asyncHandler(SessionController.logout));

export default router;
