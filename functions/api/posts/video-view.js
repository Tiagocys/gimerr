import { getSupabaseRestUrl, getSupabaseUrl, jsonResponse } from "../../_shared/auth.js";
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

async function getOptionalAuthUser(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;

  const supabaseUrl = getSupabaseUrl(env);
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      authorization,
    },
  });
  const user = await response.json().catch(() => null);
  return response.ok ? user : null;
}

function hasVideoMedia(post) {
  if (String(post?.post_type || "") === "video") return true;
  if (String(post?.media_type || "").startsWith("video/")) return true;
  return (Array.isArray(post?.media_items) ? post.media_items : [])
    .some((item) => String(item?.mediaType || item?.media_type || "").startsWith("video/"));
}

async function fetchPost(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id,post_type,status,media_type,media_items");
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar post.");
  return rows[0] || null;
}

async function insertVideoView(env, { postId, viewerId, viewerToken }) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_post_video_views`);
  const body = viewerId
    ? { post_id: postId, viewer_id: viewerId }
    : { post_id: postId, viewer_token: viewerToken };
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify(body),
  });
  if (response.ok || response.status === 409) return true;
  const payload = await response.json().catch(() => ({}));
  throw new Error(payload.message || "Não foi possível registrar visualização.");
}

async function countVideoViews(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_post_video_views`);
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
    const payload = await request.json().catch(() => ({}));
    const postId = cleanUuid(payload.postId);
    const viewerToken = cleanText(payload.viewerToken, 128);
    if (!postId) {
      return jsonResponse({ error: "Post inválido." }, { status: 400 });
    }

    const user = await getOptionalAuthUser(request, env);
    if (!user?.id && !viewerToken) {
      return jsonResponse({ error: "Identificador de visualização ausente." }, { status: 400 });
    }

    const post = await fetchPost(env, postId);
    if (!post || !hasVideoMedia(post)) {
      return jsonResponse({ error: "Vídeo não encontrado." }, { status: 404 });
    }

    try {
      await insertVideoView(env, {
        postId,
        viewerId: user?.id || null,
        viewerToken,
      });
    } catch (error) {
      if (!user?.id || !viewerToken) throw error;
      await insertVideoView(env, {
        postId,
        viewerId: null,
        viewerToken,
      });
    }

    return jsonResponse({ videoViewCount: await countVideoViews(env, postId) });
  } catch (error) {
    console.error("video view failed", error);
    return jsonResponse({ error: error?.message || "Falha ao registrar visualização." }, { status: 500 });
  }
}
