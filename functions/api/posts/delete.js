import { deleteR2Object, getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

const ALLOWED_MEDIA_PREFIXES = [
  "posts/",
  "market/",
  "videos/originals/",
  "videos/ready/",
  "videos/thumbnails/",
];

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function isAllowedMediaKey(key, ownerId) {
  const isCurrentPath = ALLOWED_MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix));
  const isLegacyVideoPath = ownerId && key.startsWith(`videos/${ownerId}/`);
  return isCurrentPath || isLegacyVideoPath;
}

function collectMediaKeys(post) {
  return [...new Set([
    post.media_key,
    post.original_media_key,
    post.ready_media_key,
    post.video_thumbnail_key,
  ]
    .map((key) => cleanText(key, 500))
    .filter(Boolean)
    .filter((key) => isAllowedMediaKey(key, post.profile_id)))];
}

async function fetchPost(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id,profile_id,status,media_key,original_media_key,ready_media_key,video_thumbnail_key");
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar o post.");
  return rows[0] || null;
}

async function deletePostRow(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("id", `eq.${postId}`);

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: getServiceHeaders(env),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível excluir o post.");
  }
}

async function deleteMediaObjects(env, keys) {
  const results = await Promise.allSettled(keys.map((key) => deleteR2Object(env, key)));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    throw failed.reason || new Error("Não foi possível remover a mídia do R2.");
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const postId = cleanText(payload.postId, 80);
    if (!postId) {
      return jsonResponse({ error: "Post ausente." }, { status: 400 });
    }

    const post = await fetchPost(env, postId);
    if (!post || post.status !== "active") {
      return jsonResponse({ error: "Post não encontrado." }, { status: 404 });
    }

    if (post.profile_id !== auth.user.id) {
      return jsonResponse({ error: "Você só pode apagar seus próprios posts." }, { status: 403 });
    }

    const mediaKeys = collectMediaKeys(post);
    await deleteMediaObjects(env, mediaKeys);
    await deletePostRow(env, postId);

    return jsonResponse({ ok: true, deletedMedia: mediaKeys });
  } catch (error) {
    console.error("post delete failed", error);
    return jsonResponse({ error: error?.message || "Falha ao apagar post." }, { status: 500 });
  }
}
