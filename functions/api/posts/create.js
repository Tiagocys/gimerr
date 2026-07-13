import { deleteR2Object, getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

const VALID_TYPES = new Set(["post", "video", "listing"]);
const VALID_MEDIA_PREFIXES = ["posts/", "videos/", "market/"];
const VIDEO_MEDIA_PREFIXES = ["videos/originals/", "videos/ready/", "videos/"];
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

function extractMentionUsernames(text, authorUsername = "") {
  const mentions = [];
  const seen = new Set();
  const author = String(authorUsername || "").toLowerCase();
  const pattern = /(^|[\s([{"'“‘])@([a-z0-9_.]{3,24})(?=$|[\s),.!?:;}"'”’\]])/gi;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    const username = match[2].replace(/\.+$/, "");
    const key = username.toLowerCase();
    if (!username || key === author || seen.has(key)) continue;
    seen.add(key);
    mentions.push(key);
  }
  return mentions;
}

function getFolderForType(type) {
  if (type === "listing") return "market/";
  if (type === "video") return "videos/originals/";
  return "posts/";
}

function inferPostType(payloadType, mediaKey, mediaType) {
  const requestedType = VALID_TYPES.has(payloadType) ? payloadType : "post";
  if (requestedType === "listing") return "listing";
  if (String(mediaType || "").startsWith("video/")) return "video";
  if (String(mediaType || "").startsWith("image/")) return "post";
  if (VIDEO_MEDIA_PREFIXES.some((prefix) => String(mediaKey || "").startsWith(prefix))) return "video";
  return "post";
}

function isValidMediaKeyForType(type, key) {
  if (!key) return true;
  return VALID_MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix))
    && key.startsWith(getFolderForType(type));
}

function normalizeMediaItems(items, postType) {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  const seen = new Set();

  for (const item of items) {
    const url = cleanText(item?.url, 500);
    const key = cleanText(item?.key, 500);
    const mediaType = cleanText(item?.mediaType, 120);
    const itemName = cleanText(item?.itemName, 120);
    const position = Number.parseInt(String(item?.position ?? ""), 10);
    if (!url || !key || seen.has(key)) continue;
    if (!isValidMediaKeyForType(postType, key)) continue;
    if (postType === "listing" && !mediaType.startsWith("image/")) continue;
    if (postType !== "listing" && normalized.length) continue;
    seen.add(key);
    normalized.push({
      url,
      key,
      mediaType,
      ...(postType === "listing" && itemName ? { itemName } : {}),
      ...(postType === "listing" && Number.isFinite(position) ? { position } : {}),
    });
    if (postType === "listing" && normalized.length >= MAX_LISTING_MEDIA_ITEMS) break;
  }

  return normalized;
}

async function userFollowsGame(env, userId, gameId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/game_follows`);
  url.searchParams.set("select", "game_igdb_id");
  url.searchParams.set("profile_id", `eq.${userId}`);
  url.searchParams.set("game_igdb_id", `eq.${gameId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar o game seguido.");
  return rows.length > 0;
}

async function userHasActiveListingForGame(env, userId, gameId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id");
  url.searchParams.set("profile_id", `eq.${userId}`);
  url.searchParams.set("game_igdb_id", `eq.${gameId}`);
  url.searchParams.set("post_type", "eq.listing");
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar seus anúncios ativos.");
  return rows.length > 0;
}

async function insertPost(env, payload) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/feed_posts`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível publicar.");
  return rows[0];
}

async function getAuthorProfile(env, userId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,display_name,username,avatar_url");
  url.searchParams.set("id", `eq.${userId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar perfil do autor.");
  return rows[0] || null;
}

async function findMentionedProfiles(env, usernames) {
  if (!usernames.length) return [];
  const url = new URL(`${getSupabaseRestUrl(env)}/public_profiles`);
  url.searchParams.set("select", "id,display_name,username");
  url.searchParams.set("username", `in.(${usernames.join(",")})`);

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    console.warn("Não foi possível resolver usuários marcados.", rows.message || rows);
    return [];
  }
  return rows;
}

async function createMentionNotifications(env, { post, author, body }) {
  const authorUsername = author?.username || "";
  const usernames = extractMentionUsernames(body, authorUsername);
  if (!usernames.length) return;

  const mentionedProfiles = await findMentionedProfiles(env, usernames);
  const recipients = mentionedProfiles.filter((profile) => profile.id && profile.id !== author?.id);
  if (!recipients.length) return;

  const authorName = author?.display_name || author?.username || "Um usuário";
  const bodyPreview = body ? body.slice(0, 180) : null;
  const notifications = recipients.map((profile) => ({
    recipient_id: profile.id,
    sender_name: authorName,
    sender_avatar_url: author?.avatar_url || null,
    type: "post_mention",
    title: `${authorName} marcou você em um post.`,
    body: bodyPreview,
    action_url: `/post?id=${post.id}`,
    data: {
      post_id: post.id,
      author_id: author?.id || null,
      author_username: authorUsername || null,
      mentioned_username: profile.username,
    },
  }));

  const response = await fetch(`${getSupabaseRestUrl(env)}/notifications`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify(notifications),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    console.warn("Não foi possível criar notificações de marcação.", payload.message || payload);
  }
}

export async function onRequestPost({ request, env }) {
  let mediaKeys = [];
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const gameId = Number(payload.gameId);
    const fallbackMediaUrl = cleanText(payload.mediaUrl, 500) || null;
    const fallbackMediaKey = cleanText(payload.mediaKey, 500);
    const fallbackMediaType = cleanText(payload.mediaType, 120) || null;
    const postType = inferPostType(payload.type, fallbackMediaKey, fallbackMediaType);
    const body = postType === "listing"
      ? cleanBodyText(payload.body, 1200)
      : cleanText(payload.body, 220);
    if (postType === "listing" && Array.isArray(payload.mediaItems) && payload.mediaItems.length > MAX_LISTING_MEDIA_ITEMS) {
      return jsonResponse({ error: "Anúncios aceitam até 15 imagens." }, { status: 400 });
    }

    let mediaItems = normalizeMediaItems(payload.mediaItems, postType);
    const primaryMedia = mediaItems[0] || (fallbackMediaUrl && fallbackMediaKey
      ? { url: fallbackMediaUrl, key: fallbackMediaKey, mediaType: fallbackMediaType }
      : null);
    const mediaUrl = primaryMedia?.url || fallbackMediaUrl;
    const mediaKey = primaryMedia?.key || fallbackMediaKey;
    const mediaType = primaryMedia?.mediaType || fallbackMediaType;
    if (postType === "listing" && !mediaItems.length && primaryMedia?.mediaType?.startsWith("image/")) {
      mediaItems = [primaryMedia];
    }
    mediaKeys = mediaItems.length ? mediaItems.map((item) => item.key) : [mediaKey].filter(Boolean);

    if (!gameId) {
      return jsonResponse({ error: "Selecione um game." }, { status: 400 });
    }

    if (!body && !mediaUrl) {
      return jsonResponse({ error: "Escreva algo ou envie uma mídia." }, { status: 400 });
    }

    if (!isValidMediaKeyForType(postType, mediaKey)) {
      return jsonResponse({ error: "Mídia incompatível com o tipo de publicação." }, { status: 400 });
    }

    const follows = await userFollowsGame(env, auth.user.id, gameId);
    if (!follows) {
      return jsonResponse({ error: "Siga este game antes de publicar nele." }, { status: 403 });
    }

    if (postType === "listing" && await userHasActiveListingForGame(env, auth.user.id, gameId)) {
      await Promise.allSettled([...new Set(mediaKeys)].map((key) => deleteR2Object(env, key)));
      return jsonResponse({ error: "Você já tem um anúncio ativo neste jogo." }, { status: 409 });
    }

    const post = await insertPost(env, {
      profile_id: auth.user.id,
      game_igdb_id: gameId,
      post_type: postType,
      body: body || null,
      media_url: mediaUrl,
      media_key: mediaKey || null,
      media_type: mediaType,
      media_items: postType === "listing" ? mediaItems : [],
      video_status: postType === "video" ? "uploaded" : "none",
      original_media_url: postType === "video" ? mediaUrl : null,
      original_media_key: postType === "video" ? mediaKey || null : null,
    });

    await (async () => {
      const author = await getAuthorProfile(env, auth.user.id);
      await createMentionNotifications(env, { post, author, body });
    })().catch((error) => {
      console.warn("Falha ao notificar usuários marcados.", error);
    });

    return jsonResponse({ post });
  } catch (error) {
    await Promise.allSettled([...new Set(mediaKeys)].map((key) => deleteR2Object(env, key)));
    console.error("post create failed", error);
    return jsonResponse({ error: error?.message || "Falha ao publicar." }, { status: 500 });
  }
}
