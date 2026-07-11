import { deleteR2Object, getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";
import { requireVerifiedProfile } from "../../_shared/verification.js";

const VALID_TYPES = new Set(["post", "video", "listing"]);
const VALID_MEDIA_PREFIXES = ["posts/", "videos/", "market/"];

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getFolderForType(type) {
  if (type === "listing") return "market/";
  if (type === "video") return "videos/originals/";
  return "posts/";
}

function isValidMediaKeyForType(type, key) {
  if (!key) return true;
  return VALID_MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix))
    && key.startsWith(getFolderForType(type));
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

export async function onRequestPost({ request, env }) {
  let mediaKey = "";
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const verification = await requireVerifiedProfile(env, auth.user.id);
    if (verification.error) return verification.error;

    const payload = await request.json().catch(() => ({}));
    const gameId = Number(payload.gameId);
    const postType = VALID_TYPES.has(payload.type) ? payload.type : "post";
    const body = cleanText(payload.body, 220);
    const mediaUrl = cleanText(payload.mediaUrl, 500) || null;
    mediaKey = cleanText(payload.mediaKey, 500);
    const mediaType = cleanText(payload.mediaType, 120) || null;

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

    const post = await insertPost(env, {
      profile_id: auth.user.id,
      game_igdb_id: gameId,
      post_type: postType,
      body: body || null,
      media_url: mediaUrl,
      media_key: mediaKey || null,
      media_type: mediaType,
      video_status: postType === "video" ? "uploaded" : "none",
      original_media_url: postType === "video" ? mediaUrl : null,
      original_media_key: postType === "video" ? mediaKey || null : null,
    });

    return jsonResponse({ post });
  } catch (error) {
    if (mediaKey) {
      await deleteR2Object(env, mediaKey).catch(() => {});
    }
    console.error("post create failed", error);
    return jsonResponse({ error: error?.message || "Falha ao publicar." }, { status: 500 });
  }
}
