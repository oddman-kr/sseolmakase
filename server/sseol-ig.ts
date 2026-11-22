// Sseolmakase: Instagram approval queue + scheduled carousel publisher.
// Secrets: SSEOL_IG_ACCESS_TOKEN, SSEOL_ADMIN_PASSCODE. Optional: SSEOL_IG_USER_ID, IG_GRAPH_BASE.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SITE = "https://oddman-kr.github.io/sseolmakase/";
const ALLOWED_ORIGIN = "https://oddman-kr.github.io";
const IG_USER_ID = Deno.env.get("SSEOL_IG_USER_ID") ?? "17841439403194282";
const GRAPH = Deno.env.get("IG_GRAPH_BASE") ?? "https://graph.facebook.com/v21.0";
const TOKEN = Deno.env.get("SSEOL_IG_ACCESS_TOKEN") ?? "";
const PASSCODE = Deno.env.get("SSEOL_ADMIN_PASSCODE") ?? "";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Vary": "Origin",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

async function graph(path: string, params: Record<string, string>, method = "POST") {
  const q = new URLSearchParams({ ...params, access_token: TOKEN });
  const url = method === "GET" ? `${GRAPH}${path}?${q}` : `${GRAPH}${path}`;
  const r = await fetch(url, method === "GET" ? {} : { method, body: q });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d?.error?.message ?? `HTTP ${r.status}`);
  return d;
}

async function waitFinished(id: string) {
  for (let i = 0; i < 20; i++) {
    const d = await graph(`/${id}`, { fields: "status_code" }, "GET");
    if (d.status_code === "FINISHED") return;
    if (d.status_code === "ERROR" || d.status_code === "EXPIRED") throw new Error(`container ${d.status_code}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("container timeout");
}

async function publishNext() {
  const { data: next } = await db.from("sseol_posts").select("*").eq("status", "approved")
    .order("approved_at", { ascending: true }).limit(1).maybeSingle();
  if (!next) return { published: null, note: "no approved posts" };
  await db.from("sseol_posts").update({ status: "publishing", error: null }).eq("id", next.id);
  try {
    const children: string[] = [];
    for (const url of next.image_urls) {
      const c = await graph(`/${IG_USER_ID}/media`, { image_url: url, is_carousel_item: "true" });
      children.push(c.id);
    }
    for (const c of children) await waitFinished(c);
    const car = await graph(`/${IG_USER_ID}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: next.caption });
    await waitFinished(car.id);
    const pub = await graph(`/${IG_USER_ID}/media_publish`, { creation_id: car.id });
    await db.from("sseol_posts").update({ status: "published", published_at: new Date().toISOString(), ig_media_id: pub.id }).eq("id", next.id);
    return { published: next.id, ig_media_id: pub.id };
  } catch (e) {
    await db.from("sseol_posts").update({ status: "failed", error: String((e as Error).message) }).eq("id", next.id);
    return { published: null, failed: next.id, error: String((e as Error).message) };
  }
}

async function loadSitePost(id: string) {
  const r = await fetch(`${SITE}posts/posts.json?t=${Date.now()}`);
  const list = await r.json();
  const p = list.find((x: any) => x.id === id);
  if (!p) return null;
  const v = p.v ? `?v=${p.v}` : "";
  return {
    id: p.id,
    title: p.title,
    caption: p.description ?? "",
    image_urls: p.images.slice(0, 10).map((n: string) => `${SITE}posts/${p.id}/${n}${v}`),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Scheduled run from pg_cron
  const cronKey = req.headers.get("x-cron-key");
  if (cronKey) {
    const { data } = await db.from("sseol_config").select("value").eq("key", "cron_key").single();
    if (!data || data.value !== cronKey) return json({ error: "forbidden" }, 403);
    if (!TOKEN) return json({ error: "SSEOL_IG_ACCESS_TOKEN not set" }, 500);
    return json(await publishNext());
  }

  if (req.headers.get("origin") !== ALLOWED_ORIGIN) return json({ error: "forbidden_origin" }, 403);
  let p: Record<string, any>;
  try { p = await req.json(); } catch { return json({ error: "bad_json" }, 400); }

  if (p.action === "list") {
    const { data } = await db.from("sseol_posts").select("id,status,approved_at,published_at,error");
    return json({ posts: data ?? [] });
  }

  if (!PASSCODE || p.passcode !== PASSCODE) return json({ error: "wrong_passcode" }, 401);

  switch (p.action) {
    case "check":
      return json({ ok: true });
    case "approve": {
      const sp = await loadSitePost(String(p.id));
      if (!sp) return json({ error: "post_not_found" }, 404);
      const { data: cur } = await db.from("sseol_posts").select("status").eq("id", sp.id).maybeSingle();
      if (cur && (cur.status === "published" || cur.status === "publishing")) return json({ error: "already_" + cur.status }, 409);
      const { error } = await db.from("sseol_posts").upsert({ ...sp, status: "approved", approved_at: new Date().toISOString(), error: null });
      return error ? json({ error: error.message }, 500) : json({ ok: true, id: sp.id, status: "approved" });
    }
    case "unapprove": {
      const { error } = await db.from("sseol_posts").update({ status: "draft", approved_at: null }).eq("id", String(p.id)).in("status", ["approved", "failed"]);
      return error ? json({ error: error.message }, 500) : json({ ok: true, id: p.id, status: "draft" });
    }
    case "delete": {
      const id = String(p.id);
      const { data: cur } = await db.from("sseol_posts").select("status").eq("id", id).maybeSingle();
      if (cur && cur.status === "publishing") return json({ error: "already_publishing" }, 409);
      const sp = cur ? null : await loadSitePost(id);
      const row = sp ? { ...sp, status: "deleted", approved_at: null } : { id, status: "deleted", approved_at: null };
      const { error } = cur ? await db.from("sseol_posts").update({ status: "deleted", approved_at: null }).eq("id", id)
                            : await db.from("sseol_posts").insert(row);
      return error ? json({ error: error.message }, 500) : json({ ok: true, id, status: "deleted" });
    }
    case "restore": {
      const { error } = await db.from("sseol_posts").update({ status: "draft" }).eq("id", String(p.id)).eq("status", "deleted");
      return error ? json({ error: error.message }, 500) : json({ ok: true, id: p.id, status: "draft" });
    }
    case "publish_now":
      if (!TOKEN) return json({ error: "SSEOL_IG_ACCESS_TOKEN not set" }, 500);
      return json(await publishNext());
    default:
      return json({ error: "unknown_action" }, 400);
  }
});
