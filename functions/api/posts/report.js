import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function fetchPost(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id,profile_id,post_type,body,media_url,media_type,video_thumbnail_url,status");
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar o post.");
  return rows[0] || null;
}

async function upsertReport(env, payload) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/post_reports?on_conflict=post_id,reporter_id`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível registrar a denúncia.");
  return rows[0] || null;
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const postId = cleanText(payload.postId, 80);
    const reason = cleanText(payload.reason, 500) || null;

    if (!postId) {
      return jsonResponse({ error: "Post ausente." }, { status: 400 });
    }

    const post = await fetchPost(env, postId);
    if (!post) {
      return jsonResponse({ error: "Post não encontrado." }, { status: 404 });
    }

    const report = await upsertReport(env, {
      post_id: postId,
      reporter_id: auth.user.id,
      reason,
      status: "pending",
      resolution: null,
      resolution_note: null,
      reviewed_at: null,
      reviewed_by: null,
      reported_profile_id: post.profile_id,
      reported_post_type: post.post_type,
      reported_post_body: post.body,
      reported_media_url: post.media_url,
      reported_media_type: post.media_type,
      reported_video_thumbnail_url: post.video_thumbnail_url,
      created_at: new Date().toISOString(),
    });

    return jsonResponse({ ok: true, report });
  } catch (error) {
    console.error("post report failed", error);
    return jsonResponse({ error: error?.message || "Falha ao denunciar post." }, { status: 500 });
  }
}
