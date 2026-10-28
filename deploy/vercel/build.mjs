// Vercel build: emits `.vercel/output` (Build Output API v3) so one project
// serves the Vite SPA as static files and the Express API as one Function.
//
// Run by `pnpm run vercel-build` (see vercel.json). Steps:
//   1. build the SPA and the API bundle
//   2. apply SQL migrations (production deploys only, see shouldMigrate)
//   3. copy the SPA into .vercel/output/static
//   4. trace the API bundle with @vercel/nft and copy only the files it needs
//      into .vercel/output/functions/api.func
//   5. write routes + cron schedules to .vercel/output/config.json
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, readlink, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { nodeFileTrace } from "@vercel/nft";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = path.join(root, ".vercel/output");
const funcDir = path.join(outputDir, "functions/api.func");
const apiDir = "artifacts/api-server";
const handler = `${apiDir}/dist/vercel.mjs`;

function run(cmd, args, env = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited with ${result.status}`);
  }
}

function flag(name) {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

// Preview deploys usually point at the same database as production, so a
// branch's unreleased migration must not run there unless asked for.
function shouldMigrate() {
  if (flag("SKIP_DB_MIGRATIONS")) return false;
  if (flag("RUN_MIGRATIONS_ON_BUILD")) return true;
  return process.env.VERCEL_ENV === "production";
}

// 1. Build
run("pnpm", ["--filter", "@workspace/invoiceplane", "run", "build"], { NODE_ENV: "production" });
run("pnpm", ["--filter", "@workspace/api-server", "run", "build"]);

// 2. Migrate
if (shouldMigrate()) {
  run("node", [`${apiDir}/dist/migrate.mjs`], { NODE_ENV: "production" });
} else {
  console.log("\nSkipping DB migrations (not a production deploy; set RUN_MIGRATIONS_ON_BUILD=1 to force).");
}

// 3. Static SPA
await rm(outputDir, { recursive: true, force: true });
await cp(path.join(root, "artifacts/invoiceplane/dist/public"), path.join(outputDir, "static"), {
  recursive: true,
});

// 4. API Function
const distFiles = readdirSync(path.join(root, apiDir, "dist"))
  // vercel.mjs plus the pino worker files esbuild-plugin-pino emits beside it.
  .filter((f) => f.endsWith(".mjs") && f !== "index.mjs" && f !== "migrate.mjs")
  .map((f) => `${apiDir}/dist/${f}`);
const runtimeAssets = [
  // Traditional Chinese PDF fonts (pdfTraditionalChinese.ts)
  ...readdirSync(path.join(root, apiDir, "fonts")).map((f) => `${apiDir}/fonts/${f}`),
  // Only needed with RUN_MIGRATIONS_ON_START=1, but small enough to always ship.
  ...readdirSync(path.join(root, "lib/db/migrations")).map((f) => `lib/db/migrations/${f}`),
];

// The bundle builds some paths from process.cwd()/__dirname (static root,
// fonts, migrations), which nft can only resolve by globbing. Keep it to
// runtime code: workspace libs, the API package, and production node_modules.
const tracedRoots = ["node_modules/", "lib/", `${apiDir}/dist/`, `${apiDir}/node_modules/`, `${apiDir}/package.json`, "package.json"];
const buildOnlyPackages = /node_modules\/(?:\.pnpm\/)?(?:@babel|@esbuild|esbuild|rollup|@rollup|vite|@vitejs|tailwindcss|@tailwindcss|lightningcss|jiti|typescript|tsx|prettier)[+@/]/;
const ignore = (p) =>
  !tracedRoots.some((r) => p === r || p.startsWith(r)) ||
  p.endsWith(".map") ||
  buildOnlyPackages.test(p);

// pdfjs-dist (via pdf-parse) loads @napi-rs/canvas and its own worker with
// computed specifiers that nft cannot follow; without them PDF parsing
// crashes (DOMMatrix undefined / "Setting up fake worker failed"). Trace both
// explicitly and keep the pnpm symlinks pointing at canvas.
const pdfParseDir = realpathSync(path.join(root, apiDir, "node_modules/pdf-parse"));
const pdfjsDir = realpathSync(path.join(pdfParseDir, "../pdfjs-dist"));
const canvasLinks = [pdfParseDir, pdfjsDir]
  .map((dir) => path.join(dir, "../@napi-rs/canvas"))
  .filter((link) => existsSync(link))
  .map((link) => path.relative(root, link));
const canvasMain = createRequire(path.join(pdfjsDir, "package.json")).resolve("@napi-rs/canvas");
const pdfjsWorker = path.join(pdfjsDir, "legacy/build/pdf.worker.mjs");

// nft warnings are unresolved optional deps (pg-native, fsevents, …); not needed at runtime.
const { fileList } = await nodeFileTrace([...distFiles, canvasMain, pdfjsWorker], { base: root, ignore });
for (const link of canvasLinks) fileList.add(link);

const files = new Set([...fileList, ...runtimeAssets]);
for (const rel of files) {
  const src = path.join(root, rel);
  const dest = path.join(funcDir, rel);
  const st = await lstat(src);
  if (st.isDirectory()) continue;
  await mkdir(path.dirname(dest), { recursive: true });
  // Keep pnpm's relative symlinks as symlinks; their targets are traced too.
  if (st.isSymbolicLink()) {
    await symlink(await readlink(src), dest);
  } else {
    await copyFile(src, dest);
  }
}
console.log(`\nPackaged ${files.size} files into the API function.`);

await writeFile(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler,
      launcherType: "Nodejs",
      // Express parses bodies itself (JSON, multer uploads); Vercel's helpers would consume them first.
      shouldAddHelpers: false,
      maxDuration: Number(process.env.API_MAX_DURATION ?? 60),
    },
    null,
    2,
  ),
);

// 5. Routing + cron
const noStore = { "cache-control": "no-store, no-cache, must-revalidate" };
await writeFile(
  path.join(outputDir, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/api(?:/.*)?$", dest: "/api" },
        {
          src: "^/assets/.*$",
          headers: { "cache-control": "public, max-age=31536000, immutable" },
          continue: true,
        },
        { src: "^/(?:index\\.html)?$", headers: noStore, continue: true },
        { handle: "filesystem" },
        // SPA fallback: client-side routes get index.html (never cached, so deploys show up at once).
        { src: "^/.*$", dest: "/index.html", headers: noStore },
      ],
      // Vercel Cron runs in UTC. The jobs used to run at 06:00 and 08:00
      // Hong Kong time (UTC+8) via node-cron; these are the same moments.
      crons: [
        { path: "/api/cron/recurring-invoices", schedule: "0 22 * * *" },
        { path: "/api/cron/quotation-reminders", schedule: "0 0 * * *" },
      ],
    },
    null,
    2,
  ),
);

console.log(`\nVercel output ready at ${path.relative(root, outputDir)}`);
