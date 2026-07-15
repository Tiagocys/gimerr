import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanUuid(value) {
  const text = cleanText(value, 120);
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
}

async function fetchPost(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id,post_type,status");
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar anúncio.");
  return rows[0] || null;
}

async function insertListingView(env, { postId, viewerId }) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_post_listing_views`);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify({ post_id: postId, viewer_id: viewerId }),
  });
  if (response.ok || response.status === 409) return true;
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.message || "Não foi possível registrar visualização.");
}

async function countListingViews(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_post_listing_views`);
  url.searchParams.set("select", "id");
  url.searchParams.set("post_id", `eq.${postId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "HEAD",
    headers: getServiceHeaders(env, { prefer: "count=exact" }),
  });
  if (!response.ok) throw new Error("Não foi possível contar visualizações.");
  const contentRange = response.headers.get("content-range") || "";
  return Number(contentRange.split("/").pop()) || 0;
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const postId = cleanUuid(payload.postId);
    if (!postId) {
      return jsonResponse({ error: "Anúncio inválido." }, { status: 400 });
    }

    const post = await fetchPost(env, postId);
    if (!post || post.post_type !== "listing") {
      return jsonResponse({ error: "Anúncio não encontrado." }, { status: 404 });
    }

    await insertListingView(env, {
      postId,
      viewerId: auth.user.id,
    });

    return jsonResponse({ listingViewCount: await countListingViews(env, postId) });
  } catch (error) {
    console.error("listing view failed", error);
    return jsonResponse({ error: error?.message || "Falha ao registrar visualização." }, { status: 500 });
  }
}
