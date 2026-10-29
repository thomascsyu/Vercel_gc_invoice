import { Router, type IRouter } from "express";
import { requireAuth } from "../../lib/auth/requireAuth";
import { scopedDataUserId } from "../../lib/auth/scopedUserId";
import { seedForUser } from "./helpers";
import publicRouter from "./public";
import pdfDocumentLayoutsRouter from "./pdf-document-layouts";
import dashboardRouter from "./dashboard";
import clientsRouter from "./clients";
import clientCertificationsRouter from "./clientCertifications";
import invoicesRouter from "./invoices";
import quotationsRouter from "./quotations";
import paymentsRouter from "./payments";
import receiptsRouter from "./receipts";
import quotationTemplatesRouter from "./quotation-templates";

const router: IRouter = Router();

// A handful of CSV-template GET routes and two public PDF routes are
// deliberately mounted before `requireAuth` below so they stay reachable
// without a session (public share-link PDFs; CSV import templates).
router.use(publicRouter);

router.use(requireAuth);

router.use(async (req, _res, next) => {
  await seedForUser(scopedDataUserId(req));
  next();
});

router.use(pdfDocumentLayoutsRouter);
router.use(dashboardRouter);
router.use(clientCertificationsRouter);
router.use(clientsRouter);
router.use(invoicesRouter);
router.use(quotationsRouter);
router.use(paymentsRouter);
router.use(receiptsRouter);
router.use(quotationTemplatesRouter);

export default router;
