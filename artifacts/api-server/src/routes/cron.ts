import { Router, type IRouter, type Request, type Response } from "express";
import { sendQuotationExpiryReminders } from "../jobs/quotationReminder";
import { runDueRecurringInvoices } from "../jobs/recurringInvoices";
import { logger } from "../lib/logger";
import { timingSafeEqualString } from "../lib/timingSafeEqualString";

/**
 * HTTP triggers for the daily jobs. On Vercel there is no long-lived process
 * for node-cron, so Vercel Cron calls these instead (see scripts/vercel-build.mjs).
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; without CRON_SECRET the
 * endpoints stay disabled so they cannot be triggered anonymously.
 */
const router: IRouter = Router();

function cronAuthorized(req: Request, res: Response): boolean {
  const secret = process.env["CRON_SECRET"]?.trim();
  if (!secret) {
    res.status(503).json({ error: "CRON_SECRET is not configured" });
    return false;
  }
  if (!timingSafeEqualString(req.get("authorization") ?? "", `Bearer ${secret}`)) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

router.get("/cron/quotation-reminders", async (req, res) => {
  if (!cronAuthorized(req, res)) return;
  try {
    await sendQuotationExpiryReminders();
    res.json({ status: "ok" });
  } catch (err) {
    logger.error({ err }, "Cron quotation reminder job failed");
    res.status(500).json({ error: "Job failed" });
  }
});

router.get("/cron/recurring-invoices", async (req, res) => {
  if (!cronAuthorized(req, res)) return;
  try {
    const { generated } = await runDueRecurringInvoices();
    res.json({ status: "ok", generated });
  } catch (err) {
    logger.error({ err }, "Cron recurring invoice job failed");
    res.status(500).json({ error: "Job failed" });
  }
});

export default router;
