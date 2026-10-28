import app from "./app";
import { logger } from "./lib/logger";
import { startQuotationReminderJob } from "./jobs/quotationReminder";
import { startRecurringInvoiceJob } from "./jobs/recurringInvoices";
import { runSqlMigrationsOnStartup } from "./lib/db/migrate";
import { assertProductionSecurityConfig } from "./lib/productionGuards";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Log all registered routes for debugging
function logRoutes() {
  const routes: string[] = [];
  if (!app._router?.stack) {
    logger.info("No routes registered yet");
    return;
  }
  app._router.stack.forEach((middleware: any) => {
    if (middleware.route) {
      routes.push(`${Object.keys(middleware.route.methods).join(",")} ${middleware.route.path}`);
    } else if (middleware.name === "router") {
      routes.push(`[router] ${middleware.regexp}`);
    }
  });
  logger.info({ routes }, "Registered routes");
}

// Start server after migrations
async function startServer() {
  assertProductionSecurityConfig();
  await runSqlMigrationsOnStartup();

  const server = app.listen(port, () => {
    logger.info({ port }, "Server listening");
    logRoutes();
    startQuotationReminderJob();
    startRecurringInvoiceJob();
  });

  server.on("error", (err) => {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  });
}

startServer();
