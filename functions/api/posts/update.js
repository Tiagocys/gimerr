import { deleteR2Object, getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

const MAX_LISTING_MEDIA_ITEMS = 15;

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

function normalizeMediaItems(items) {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  const seen = new Set();

  for (const item of items) {
    const url = cleanText(item?.url, 500);
    const key = cleanText(item?.key, 500);
    const mediaType = cleanText(item?.mediaType, 120);
    const itemName = cleanText(item?.itemName, 120);
    const priceLabel = cleanText(item?.priceLabel, 80);
    const position = Number.parseInt(String(item?.position ?? ""), 10);
    const hasMedia = Boolean(url && key);
    if (!hasMedia && !itemName && !priceLabel) continue;
    if (hasMedia && seen.has(key)) continue;
    if (hasMedia && !key.startsWith("market/")) continue;
    if (hasMedia && !mediaType.startsWith("image/")) continue;
    if (hasMedia) seen.add(key);
    normalized.push({
      ...(hasMedia ? { url, key, mediaType } : {}),
      ...(itemName ? { itemName } : {}),
      ...(priceLabel ? { priceLabel } : {}),
      ...(Number.isFinite(position) ? { position } : {}),
    });
    if (normalized.length >= MAX_LISTING_MEDIA_ITEMS) break;
  }

  return normalized;
}

async function fetchPost(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id,profile_id,post_type,status,media_items");
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

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const postId = cleanText(payload.postId, 80);
    const body = cleanBodyText(payload.body, 1200);
    if (!postId) return jsonResponse({ error: "Anúncio ausente." }, { status: 400 });

    if (Array.isArray(payload.mediaItems) && payload.mediaItems.length > MAX_LISTING_MEDIA_ITEMS) {
      return jsonResponse({ error: "Anúncios aceitam até 15 imagens." }, { status: 400 });
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
    const primaryMedia = mediaItems.find((item) => item?.url && item?.key) || null;
    const updated = await updatePost(env, postId, {
      body,
      media_url: primaryMedia?.url || null,
      media_key: primaryMedia?.key || null,
      media_type: primaryMedia?.mediaType || null,
      media_items: mediaItems,
    });

    await deleteRemovedMedia(env, post.media_items, mediaItems);

    return jsonResponse({ post: updated });
  } catch (error) {
    console.error("post update failed", error);
    return jsonResponse({ error: error?.message || "Falha ao salvar anúncio." }, { status: 500 });
  }
}
