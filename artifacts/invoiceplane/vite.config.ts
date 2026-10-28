import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Dev server / preview use PORT; production `vite build` does not need it, so default
// when unset (e.g. CI) so `pnpm run build` succeeds without Replit-specific env.
const rawPort = process.env.PORT ?? "5000";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Asset base URL for the built app; default to root when unset.
const basePath = process.env.BASE_PATH ?? "/";

/**
 * Dev/preview: forward browser `/api/*` to the API server (see README).
 * When Vite and the API would both use port 8080 (common on Replit), the proxy must
 * target a *different* port or it forwards to Vite itself and every API call fails
 * with "Failed to fetch". Default: API on 8080 when Vite is not on 8080; API on 8081
 * when Vite listens on 8080. Override with `VITE_API_PROXY_TARGET`.
 */
const defaultApiProxyPort = port === 8080 ? 8081 : 8080;
const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET?.trim() ||
  `http://127.0.0.1:${defaultApiProxyPort}`;

const apiProxy = {
  "/api": {
    target: apiProxyTarget,
    changeOrigin: true,
  },
} as const;

export default defineConfig(async () => {
  const isProdBuild = process.env.NODE_ENV === "production";
  const replitPlugins =
    !isProdBuild &&
    process.env.REPL_ID !== undefined
      ? [
          (
            await import("@replit/vite-plugin-cartographer")
          ).cartographer({
            root: path.resolve(import.meta.dirname, ".."),
          }),
          (await import("@replit/vite-plugin-dev-banner")).devBanner(),
        ]
      : [];

  const runtimeErrorOverlay = !isProdBuild
    ? [(await import("@replit/vite-plugin-runtime-error-modal")).default()]
    : [];

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      ...runtimeErrorOverlay,
      ...replitPlugins,
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(
          import.meta.dirname,
          "..",
          "..",
          "attached_assets",
        ),
        // Workspace-linked @workspace/api-client-react resolves from lib/; force peer
        // deps to the app install so `pnpm run build` works in artifact-only contexts.
        "@tanstack/react-query": path.dirname(
          require.resolve("@tanstack/react-query/package.json"),
        ),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      // Match mockup-sandbox: large shared vendor chunks can exceed 1000 kB.
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("recharts")) return "vendor-recharts";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("@radix-ui")) return "vendor-radix";
            if (id.includes("@tanstack/react-query")) return "vendor-query";
          },
        },
      },
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: apiProxy,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: apiProxy,
    },
  };
});
