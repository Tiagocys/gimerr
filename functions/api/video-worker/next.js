import { getSupabaseRestUrl, jsonResponse } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function getWorkerSecret(env) {
  return env.VIDEO_WORKER_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
}

function requireWorker(request, env) {
  const expected = getWorkerSecret(env);
  const provided = request.headers.get("x-video-worker-secret") || "";
  if (!expected || provided !== expected) {
    return jsonResponse({ error: "Worker não autorizado." }, { status: 401 });
  }
  return null;
}

async function fetchNextUploadedPost(env) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id,profile_id,media_url,media_key,media_type,original_media_url,original_media_key,created_at");
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("post_type", "eq.video");
  url.searchParams.set("video_status", "eq.uploaded");
  url.searchParams.set("order", "created_at.asc");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível buscar fila de vídeo.");
  return rows[0] || null;
}

async function markProcessing(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("video_status", "eq.uploaded");

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify({
      video_status: "processing",
      processing_started_at: new Date().toISOString(),
      processing_error: null,
    }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível reservar vídeo.");
  return rows[0] || null;
}

export async function onRequestPost({ request, env }) {
  try {
    const unauthorized = requireWorker(request, env);
    if (unauthorized) return unauthorized;

    const nextPost = await fetchNextUploadedPost(env);
    if (!nextPost) {
      return jsonResponse({ job: null });
    }

    const reserved = await markProcessing(env, nextPost.id);
    if (!reserved) {
      return jsonResponse({ job: null });
    }

    return jsonResponse({
      job: {
        id: reserved.id,
        profileId: reserved.profile_id,
        sourceUrl: reserved.original_media_url || reserved.media_url,
        sourceKey: reserved.original_media_key || reserved.media_key,
        sourceType: reserved.media_type,
      },
    });
  } catch (error) {
    console.error("video worker next failed", error);
    return jsonResponse({ error: error?.message || "Falha ao buscar próximo vídeo." }, { status: 500 });
  }
}
