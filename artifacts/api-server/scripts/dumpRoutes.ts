/**
 * Dev-only tool: prints every registered "METHOD /path" pair, in registration
 * order, for one of the route modules. Used to prove route-table parity
 * before/after splitting a monolithic route file into per-resource modules —
 * run against the file on each side of a refactor and diff the two outputs.
 *
 * Usage: node --import tsx scripts/dumpRoutes.ts <./src/routes/invoiceplane|./src/routes/invoiceplane-modules|./src/routes/proposals>
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

type Layer = {
  route?: { path: unknown; stack: Array<{ method?: string }> };
  name?: string;
  handle?: { stack?: Layer[] };
  regexp?: RegExp;
};

function walk(stack: Layer[], prefix: string, out: string[]) {
  for (const layer of stack) {
    if (layer.route) {
      const routePath = layer.route.path;
      const methods = layer.route.stack.map((s) => (s.method ?? "?").toUpperCase());
      for (const m of methods) out.push(`${m} ${prefix}${String(routePath)}`);
    } else if (layer.name === "router" && layer.handle?.stack) {
      walk(layer.handle.stack, prefix, out);
    }
  }
}

async function main() {
  const modPath = process.argv[2];
  if (!modPath) {
    console.error("Usage: dumpRoutes.ts <module-path>");
    process.exit(1);
  }
  process.env.DATABASE_URL ??= "postgresql://127.0.0.1:5432/postgres";
  process.env.JWT_SECRET ??= "route-dump-secret-that-is-at-least-32-chars";
  const resolved = path.resolve(modPath);
  const mod = await import(pathToFileURL(resolved).href);
  const router = mod.default;
  const out: string[] = [];
  walk(router.stack, "", out);
  for (const line of out) console.log(line);
}

main();
