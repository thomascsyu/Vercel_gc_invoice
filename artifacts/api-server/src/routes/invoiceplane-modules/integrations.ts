import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { requireAdmin } from "../../lib/auth/requireAdmin";
import { ensureCompanySettings } from "./helpers";

const router: IRouter = Router();

const DeepSeekTestBody = z.object({ apiKey: z.string().optional() });

router.post("/integrations/deepseek/test", requireAdmin, async (req, res) => {
  const body = DeepSeekTestBody.parse(req.body ?? {});
  const current = await ensureCompanySettings();
  const apiKey = (body.apiKey?.trim() || current.deepseekApiKey?.trim() || "").trim();
  if (!apiKey) {
    res.status(400).json({ error: "No API key — enter one in the field or save settings first." });
    return;
  }
  const base = (process.env["DEEPSEEK_API_BASE"] || "https://api.deepseek.com").replace(/\/$/, "");
  try {
    const r = await fetch(`${base}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      const text = await r.text();
      res.status(400).json({
        ok: false,
        error: `DeepSeek returned ${r.status}`,
        detail: text.slice(0, 500),
      });
      return;
    }
    const data = (await r.json()) as { data?: unknown[] };
    const count = Array.isArray(data?.data) ? data.data.length : 0;
    res.json({ ok: true, message: `Connection OK (${count} models visible).` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(502).json({ ok: false, error: `Request failed: ${msg}` });
  }
});

export default router;
