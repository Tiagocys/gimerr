import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function toPublicPost(row) {
  return {
    id: row.id,
    gameId: row.game_igdb_id,
    type: row.post_type,
    body: row.body,
    mediaUrl: row.media_url,
    mediaType: row.media_type,
    videoStatus: row.video_status,
    originalMediaUrl: row.original_media_url,
    readyMediaUrl: row.ready_media_url,
    videoThumbnailUrl: row.video_thumbnail_url,
    commentCount: Number(row.comment_count || 0),
    processingError: row.processing_error,
    createdAt: row.created_at,
    author: {
      id: row.profile_id,
      displayName: row.display_name || row.username || "Usuário Gimerr",
      username: row.username,
      avatarUrl: row.avatar_url,
    },
    game: {
      id: row.game_igdb_id,
      name: row.game_name,
      slug: row.game_slug,
      coverUrl: row.game_cover_url,
    },
  };
}

function cleanNumber(value, fallback, { min = 0, max = 20 } = {}) {
  const number = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const requestUrl = new URL(request.url);
    const limit = cleanNumber(requestUrl.searchParams.get("limit"), 10, { min: 1, max: 15 });
    const offset = cleanNumber(requestUrl.searchParams.get("offset"), 0, { min: 0, max: 5000 });
    const fetchLimit = limit + 1;

    const url = new URL(`${getSupabaseRestUrl(env)}/public_feed_posts`);
    url.searchParams.set("select", "*");
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", String(fetchLimit));
    if (offset > 0) url.searchParams.set("offset", String(offset));

    const response = await fetch(url.toString(), {
      headers: getServiceHeaders(env),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error(rows.message || "Não foi possível carregar o feed.");

    const hasMore = rows.length > limit;
    return jsonResponse({
      posts: rows.slice(0, limit).map(toPublicPost),
      hasMore,
      nextOffset: offset + Math.min(rows.length, limit),
    });
  } catch (error) {
    console.error("post feed failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar feed." }, { status: 500 });
  }
}
