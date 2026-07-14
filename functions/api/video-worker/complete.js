import { deleteR2Object, getSupabaseRestUrl, jsonResponse } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

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

async function patchPost(env, postId, payload) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("status", "eq.active");

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível atualizar vídeo.");
  return rows[0] || null;
}

async function fetchPost(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id,post_type,status,media_items,video_thumbnail_key");
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar vídeo.");
  return rows[0] || null;
}

function replaceReadyVideoMediaItems(items, originalKey, readyKey, readyUrl, readyType) {
  if (!Array.isArray(items) || !items.length || !originalKey) return null;
  let changed = false;
  const nextItems = items.map((item) => {
    const isTargetVideo = String(item?.mediaType || "").startsWith("video/")
      && (item?.key === originalKey || item?.mediaRole === "listingVideo");
    if (!isTargetVideo) return item;
    changed = true;
    return {
      ...item,
      url: readyUrl,
      key: readyKey,
      mediaType: readyType,
      mediaRole: item?.mediaRole || "listingVideo",
    };
  });
  return changed ? nextItems : null;
}

export async function onRequestPost({ request, env }) {
  try {
    const unauthorized = requireWorker(request, env);
    if (unauthorized) return unauthorized;

    const payload = await request.json().catch(() => ({}));
    const postId = cleanText(payload.postId, 80);
    const status = payload.status === "failed"
      ? "failed"
      : payload.status === "thumbnail"
        ? "thumbnail"
        : "ready";

    if (!postId) {
      return jsonResponse({ error: "Post ausente." }, { status: 400 });
    }

    if (status === "thumbnail") {
      const thumbnailKey = cleanText(payload.thumbnailKey, 500);
      const thumbnailUrl = cleanText(payload.thumbnailUrl, 500);
      if (!thumbnailKey.startsWith("videos/thumbnails/") || !thumbnailUrl) {
        return jsonResponse({ error: "Capa do vídeo inválida." }, { status: 400 });
      }
      const currentPost = await fetchPost(env, postId);
      const post = await patchPost(env, postId, {
        video_thumbnail_url: thumbnailUrl,
        video_thumbnail_key: thumbnailKey,
      });
      if (!post) {
        await deleteR2Object(env, thumbnailKey).catch(() => {});
        return jsonResponse({ post: null, cancelled: true });
      }
      const previousThumbnailKey = cleanText(currentPost?.video_thumbnail_key, 500);
      if (previousThumbnailKey && previousThumbnailKey !== thumbnailKey && previousThumbnailKey.startsWith("videos/thumbnails/")) {
        await deleteR2Object(env, previousThumbnailKey).catch(() => {});
      }
      return jsonResponse({ post });
    }

    if (status === "failed") {
      const post = await patchPost(env, postId, {
        video_status: "failed",
        processing_finished_at: new Date().toISOString(),
        processing_error: cleanText(payload.error, 500) || "Falha no processamento.",
      });
      return jsonResponse({ post });
    }

    const readyKey = cleanText(payload.readyKey, 500);
    const readyUrl = cleanText(payload.readyUrl, 500);
    const readyType = cleanText(payload.mediaType, 120) || "video/mp4";
    const originalKey = cleanText(payload.originalKey, 500);
    const thumbnailKey = cleanText(payload.thumbnailKey, 500);
    const thumbnailUrl = cleanText(payload.thumbnailUrl, 500);

    if (!readyKey || !readyKey.startsWith("videos/ready/") || !readyUrl) {
      return jsonResponse({ error: "Vídeo final inválido." }, { status: 400 });
    }

    const currentPost = await fetchPost(env, postId);
    if (!currentPost) {
      await Promise.allSettled([
        deleteR2Object(env, readyKey),
        thumbnailKey.startsWith("videos/thumbnails/") ? deleteR2Object(env, thumbnailKey) : Promise.resolve(),
      ]);
      return jsonResponse({ post: null, cancelled: true });
    }
    const nextMediaItems = replaceReadyVideoMediaItems(
      currentPost.media_items,
      originalKey,
      readyKey,
      readyUrl,
      readyType,
    );

    const post = await patchPost(env, postId, {
      video_status: "ready",
      media_url: readyUrl,
      media_key: readyKey,
      media_type: readyType,
      ready_media_url: readyUrl,
      ready_media_key: readyKey,
      ...(nextMediaItems ? { media_items: nextMediaItems } : {}),
      ...(thumbnailKey.startsWith("videos/thumbnails/") && thumbnailUrl ? {
        video_thumbnail_url: thumbnailUrl,
        video_thumbnail_key: thumbnailKey,
      } : {}),
      processing_finished_at: new Date().toISOString(),
      processing_error: null,
    });

    if (!post) {
      await Promise.allSettled([
        deleteR2Object(env, readyKey),
        thumbnailKey.startsWith("videos/thumbnails/") ? deleteR2Object(env, thumbnailKey) : Promise.resolve(),
      ]);
      return jsonResponse({ post: null, cancelled: true });
    }

    if (originalKey?.startsWith("videos/originals/")) {
      await deleteR2Object(env, originalKey).catch((error) => {
        console.warn("Não foi possível remover vídeo original.", error);
      });
    }

    return jsonResponse({ post });
  } catch (error) {
    console.error("video worker complete failed", error);
    return jsonResponse({ error: error?.message || "Falha ao concluir vídeo." }, { status: 500 });
  }
}
