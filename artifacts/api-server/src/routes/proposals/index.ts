import { Router, type IRouter } from "express";
import { requireAuth } from "../../lib/auth/requireAuth";
import publicRouter from "./public";
import dashboardRouter from "./dashboard";
import coreRouter from "./core";
import lifecycleRouter from "./lifecycle";
import activityRouter from "./activity";
import milestonesRouter from "./milestones";
import uploadsRouter from "./uploads";
import { requireProposalsEnabled } from "./requireProposalsEnabled";

const router: IRouter = Router();

// ---------- Public routes (no auth) ----------
router.use(publicRouter);

// ---------- Authenticated routes ----------
router.use(requireAuth);
router.use(requireProposalsEnabled);

router.use(dashboardRouter);
router.use(coreRouter);
router.use(lifecycleRouter);
router.use(activityRouter);
router.use(milestonesRouter);
router.use(uploadsRouter);

export default router;
