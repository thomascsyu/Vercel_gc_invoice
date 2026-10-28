import express, { Router, type IRouter } from "express";
import { requireAuth } from "../../lib/auth/requireAuth";
import apiKeysRouter from "./api-keys";
import backupRouter from "./backup";
import companySettingsRouter from "./company-settings";
import consultantsRouter from "./consultants";
import emailSendingRouter from "./email-sending";
import gmailRouter from "./gmail";
import { ensureCompanySettings, seedConsultants } from "./helpers";
import integrationsRouter from "./integrations";
import jobOrdersRouter from "./job-orders";
import recurringInvoicesRouter from "./recurring-invoices";
import uploadsRouter from "./uploads";
import usersRouter from "./users";

const router: IRouter = Router();

// ---------- Gmail OAuth (public /callback + admin-gated /start) — must run before
// the global requireAuth below so /callback works without a logged-in browser session ----------
router.use(gmailRouter);

router.use(requireAuth);

// ---------- Logo upload (admin) — registered before DB seed middleware ----------
router.use(uploadsRouter);

router.use(async (_req, _res, next) => {
  await seedConsultants();
  await ensureCompanySettings();
  next();
});

// ---------- /me + Users (admin) ----------
router.use(usersRouter);

// ---------- Backup / restore (admin) ----------
router.use(backupRouter);

// ---------- Consultants ----------
router.use(consultantsRouter);

// ---------- Job Orders (+ PDF, email-consultant, quotation/invoice conversion) ----------
router.use(jobOrdersRouter);

// ---------- Recurring Invoices ----------
router.use(recurringInvoicesRouter);

// ---------- Company Settings ----------
router.use(companySettingsRouter);

// ---------- Integrations (DeepSeek) ----------
router.use(integrationsRouter);

// ---------- API Keys (admin) ----------
router.use(apiKeysRouter);

// ---------- Email Sending (Gmail API) ----------
router.use(emailSendingRouter);

export default router;
