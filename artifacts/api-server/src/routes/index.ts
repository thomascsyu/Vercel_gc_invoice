import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import cronRouter from "./cron";
import invoiceplaneRouter from "./invoiceplane";
import invoiceplaneModulesRouter from "./invoiceplane-modules";
import proposalsRouter from "./proposals";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cronRouter);
router.use(authRouter);
router.use(storageRouter);
router.use(proposalsRouter);
router.use(invoiceplaneModulesRouter);
router.use(invoiceplaneRouter);

router.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default router;
