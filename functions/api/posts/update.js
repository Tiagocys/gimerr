import { deleteR2Object, getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";
import { requireDiscordBotVerifiedForVideoUpload } from "../../_shared/verification.js";

const MAX_LISTING_MEDIA_ITEMS = 15;
const MAX_LISTING_VIDEO_ITEMS = 1;
const VIDEO_MEDIA_PREFIXES = ["videos/originals/", "videos/ready/", "videos/"];
const VIDEO_THUMBNAIL_PREFIX = "videos/thumbnails/";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanBodyText(value, maxLength) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function collectMediaKeys(items) {
  return [...new Set((Array.isArray(items) ? items : [])
    .map((item) => cleanText(item?.key, 500))
    .filter(Boolean))];
}

function getVideoMediaItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => String(item?.mediaType || "").startsWith("video/") && item?.key && item?.url);
}

function hasSameKeys(leftItems, rightItems) {
  const leftKeys = collectMediaKeys(leftItems).sort();
  const rightKeys = collectMediaKeys(rightItems).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

function normalizeMediaItems(items) {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  const seen = new Set();
  let listingImageCount = 0;
  let listingVideoCount = 0;

  for (const item of items) {
    const url = cleanText(item?.url, 500);
    const key = cleanText(item?.key, 500);
    const mediaType = cleanText(item?.mediaType, 120);
    const thumbnailUrl = cleanText(item?.thumbnailUrl, 500);
    const thumbnailKey = cleanText(item?.thumbnailKey, 500);
    const itemName = cleanText(item?.itemName, 120);
    const priceLabel = cleanText(item?.priceLabel, 80);
    const position = Number.parseInt(String(item?.position ?? ""), 10);
    const hasMedia = Boolean(url && key);
    if (!hasMedia && !itemName && !priceLabel) continue;
    if (hasMedia && seen.has(key)) continue;
    if (hasMedia) {
      const isListingImage = mediaType.startsWith("image/") && key.startsWith("market/");
      const isListingVideo = mediaType.startsWith("video/") && VIDEO_MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix));
      if (!isListingImage && !isListingVideo) continue;
      if (isListingImage && listingImageCount >= MAX_LISTING_MEDIA_ITEMS) continue;
      if (isListingVideo && listingVideoCount >= MAX_LISTING_VIDEO_ITEMS) continue;
      if (isListingImage) listingImageCount += 1;
      if (isListingVideo) listingVideoCount += 1;
    }
    if (hasMedia) seen.add(key);
    normalized.push({
      ...(hasMedia ? { url, key, mediaType } : {}),
      ...(itemName ? { itemName } : {}),
      ...(priceLabel ? { priceLabel } : {}),
      ...(Number.isFinite(position) ? { position } : {}),
      ...(mediaType.startsWith("video/") ? { mediaRole: "listingVideo" } : {}),
      ...(mediaType.startsWith("video/") && thumbnailUrl && thumbnailKey.startsWith(VIDEO_THUMBNAIL_PREFIX)
        ? { thumbnailUrl, thumbnailKey }
        : {}),
    });
  }

  return normalized;
}

async function fetchPost(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id,profile_id,post_type,status,media_items,original_media_key,ready_media_key,video_thumbnail_key");
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar o anúncio.");
  return rows[0] || null;
}

async function updatePost(env, postId, payload) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("id", `eq.${postId}`);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível salvar o anúncio.");
  return rows[0] || null;
}

async function deleteRemovedMedia(env, previousItems, nextItems) {
  const nextKeys = new Set(collectMediaKeys(nextItems));
  const removedKeys = collectMediaKeys(previousItems).filter((key) => !nextKeys.has(key));
  await Promise.allSettled(removedKeys.map((key) => deleteR2Object(env, key)));
}

async function deleteRemovedVideoFiles(env, post, videoChanged) {
  if (!videoChanged) return;
  const keys = [
    cleanText(post?.original_media_key, 500),
    cleanText(post?.ready_media_key, 500),
    cleanText(post?.video_thumbnail_key, 500),
  ].filter(Boolean);
  await Promise.allSettled([...new Set(keys)].map((key) => deleteR2Object(env, key)));
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const postId = cleanText(payload.postId, 80);
    const body = cleanBodyText(payload.body, 1200);
    if (!postId) return jsonResponse({ error: "Anúncio ausente." }, { status: 400 });

    if (Array.isArray(payload.mediaItems) && payload.mediaItems.length > MAX_LISTING_MEDIA_ITEMS + MAX_LISTING_VIDEO_ITEMS) {
      return jsonResponse({ error: "Anúncios aceitam até 15 imagens e 1 vídeo." }, { status: 400 });
    }

    const post = await fetchPost(env, postId);
    if (!post || post.status !== "active" || post.post_type !== "listing") {
      return jsonResponse({ error: "Anúncio não encontrado." }, { status: 404 });
    }
    if (post.profile_id !== auth.user.id) {
      return jsonResponse({ error: "Você só pode editar seus próprios anúncios." }, { status: 403 });
    }
    if (!body) {
      return jsonResponse({ error: "Informe pelo menos um item no anúncio." }, { status: 400 });
    }

    const mediaItems = normalizeMediaItems(payload.mediaItems);
    const previousVideoItems = getVideoMediaItems(post.media_items);
    const nextVideoItems = getVideoMediaItems(mediaItems);
    const nextVideoMedia = nextVideoItems[0] || null;
    const videoChanged = !hasSameKeys(previousVideoItems, nextVideoItems);
    if (nextVideoItems.length) {
      const verification = await requireDiscordBotVerifiedForVideoUpload(env, auth.user.id);
      if (verification.error) return verification.error;
    }
    const primaryMedia = mediaItems.find((item) => item?.url && item?.key) || null;
    const videoPayload = videoChanged
      ? {
        video_status: nextVideoMedia ? "uploaded" : "none",
        original_media_url: nextVideoMedia?.url || null,
        original_media_key: nextVideoMedia?.key || null,
        ready_media_url: null,
        ready_media_key: null,
        video_thumbnail_url: nextVideoMedia?.thumbnailUrl || null,
        video_thumbnail_key: nextVideoMedia?.thumbnailKey || null,
        processing_started_at: null,
        processing_finished_at: null,
        processing_error: null,
      }
      : {};
    const updated = await updatePost(env, postId, {
      body,
      media_url: primaryMedia?.url || null,
      media_key: primaryMedia?.key || null,
      media_type: primaryMedia?.mediaType || null,
      media_items: mediaItems,
      ...videoPayload,
    });

    await deleteRemovedMedia(env, post.media_items, mediaItems);
    await deleteRemovedVideoFiles(env, post, videoChanged);

    return jsonResponse({ post: updated });
  } catch (error) {
    console.error("post update failed", error);
    return jsonResponse({ error: error?.message || "Falha ao salvar anúncio." }, { status: 500 });
  }
}
