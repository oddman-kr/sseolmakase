// Sseolmakase Uploader: stateless proxy between the static site and TikTok's API.
// Holds the client secret (Supabase secret TIKTOK_CLIENT_SECRET); never stores user tokens.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CLIENT_KEY = Deno.env.get("SSEOL_TIKTOK_CLIENT_KEY") ?? "sbaw3pz0bn65if7xx6";
const CLIENT_SECRET = Deno.env.get("SSEOL_TIKTOK_CLIENT_SECRET") ?? "";
const REDIRECT_URI = "https://oddman-kr.github.io/sseolmakase/callback.html";
const ALLOWED_ORIGIN = "https://oddman-kr.github.io";
const MEDIA_PREFIX = "https://oddman-kr.github.io/sseolmakase/";
const API = "https://open.tiktokapis.com/v2";

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function tiktok(path: string, init: RequestInit) {
  const r = await fetch(API + path, init);
  const text = await r.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return json(data, r.status);
}

function oauth(params: Record<string, string>) {
  return tiktok("/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: CLIENT_KEY, client_secret: CLIENT_SECRET, ...params }),
  });
}

function bearer(token: string, extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (req.headers.get("origin") !== ALLOWED_ORIGIN) return json({ error: "forbidden_origin" }, 403);
  if (!CLIENT_SECRET) return json({ error: "server_not_configured" }, 500);

  let p: Record<string, any>;
  try { p = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const token = typeof p.access_token === "string" ? p.access_token : "";

  switch (p.action) {
    case "exchange":
      if (typeof p.code !== "string") return json({ error: "missing_code" }, 400);
      return oauth({ code: p.code, grant_type: "authorization_code", redirect_uri: REDIRECT_URI });

    case "refresh":
      if (typeof p.refresh_token !== "string") return json({ error: "missing_refresh_token" }, 400);
      return oauth({ refresh_token: p.refresh_token, grant_type: "refresh_token" });

    case "revoke":
      return tiktok("/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: CLIENT_KEY, client_secret: CLIENT_SECRET, token }),
      });

    case "user_info":
      return tiktok("/user/info/?fields=open_id,avatar_url,display_name", { headers: bearer(token) });

    case "creator_info":
      return tiktok("/post/publish/creator_info/query/", {
        method: "POST",
        headers: bearer(token, { "Content-Type": "application/json; charset=UTF-8" }),
      });

    case "post_photo": {
      const b = p.body ?? {};
      const imgs: unknown[] = b?.source_info?.photo_images ?? [];
      if (!Array.isArray(imgs) || imgs.length < 1 || imgs.length > 35 ||
          !imgs.every((u) => typeof u === "string" && u.startsWith(MEDIA_PREFIX))) {
        return json({ error: "invalid_photo_images" }, 400);
      }
      if (b.post_mode !== "DIRECT_POST" && b.post_mode !== "MEDIA_UPLOAD") return json({ error: "invalid_post_mode" }, 400);
      return tiktok("/post/publish/content/init/", {
        method: "POST",
        headers: bearer(token, { "Content-Type": "application/json; charset=UTF-8" }),
        body: JSON.stringify({ ...b, media_type: "PHOTO", source_info: { ...b.source_info, source: "PULL_FROM_URL" } }),
      });
    }

    case "status":
      return tiktok("/post/publish/status/fetch/", {
        method: "POST",
        headers: bearer(token, { "Content-Type": "application/json; charset=UTF-8" }),
        body: JSON.stringify({ publish_id: p.publish_id }),
      });

    default:
      return json({ error: "unknown_action" }, 400);
  }
});
