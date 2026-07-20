import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";
import { fetchIgnoredProfileIds, inFilter } from "../../_shared/ignored-users.js";

function toPublicPost(row) {
  return {
    id: row.id,
    gameId: row.game_igdb_id,
    type: row.post_type,
    body: row.body,
    mediaUrl: row.media_url,
    mediaType: row.media_type,
    mediaItems: Array.isArray(row.media_items) ? row.media_items : [],
    videoStatus: row.video_status,
    originalMediaUrl: row.original_media_url,
    readyMediaUrl: row.ready_media_url,
    videoThumbnailUrl: row.video_thumbnail_url,
    commentCount: Number(row.comment_count || 0),
    videoViewCount: Number(row.video_view_count || 0),
    listingViewCount: Number(row.listing_view_count || 0),
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

async function fetchPreferenceIds(env, profileId) {
  const headers = getServiceHeaders(env);
  const [gamesResponse, recommendationsResponse] = await Promise.all([
    fetch(`${getSupabaseRestUrl(env)}/game_follows?select=game_igdb_id&profile_id=eq.${profileId}&limit=500`, {
      headers,
    }),
    fetch(`${getSupabaseRestUrl(env)}/profile_recommendations?select=recommended_id&recommender_id=eq.${profileId}&limit=500`, {
      headers,
    }),
  ]);

  const [games, recommendations] = await Promise.all([
    gamesResponse.json().catch(() => []),
    recommendationsResponse.json().catch(() => []),
  ]);

  if (!gamesResponse.ok) throw new Error(games.message || "Não foi possível carregar preferências de jogos.");
  if (!recommendationsResponse.ok) throw new Error(recommendations.message || "Não foi possível carregar recomendações.");

  return {
    followedGameIds: new Set((games || []).map((row) => String(row.game_igdb_id)).filter(Boolean)),
    recommendedProfileIds: new Set((recommendations || []).map((row) => String(row.recommended_id)).filter(Boolean)),
  };
}

function getPreferenceScore(row, preferences) {
  let score = 0;
  if (preferences.followedGameIds.has(String(row.game_igdb_id))) score += 2;
  if (preferences.recommendedProfileIds.has(String(row.profile_id))) score += 1;
  return score;
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const requestUrl = new URL(request.url);
    const limit = cleanNumber(requestUrl.searchParams.get("limit"), 10, { min: 1, max: 15 });
    const offset = cleanNumber(requestUrl.searchParams.get("offset"), 0, { min: 0, max: 5000 });
    const fetchLimit = limit + 1;
    const queryLimit = Math.min(500, Math.max(fetchLimit, offset + fetchLimit + 60));
    const ignoredProfileIds = [...(await fetchIgnoredProfileIds(env, auth.user.id))];
    const preferences = await fetchPreferenceIds(env, auth.user.id);

    const url = new URL(`${getSupabaseRestUrl(env)}/public_feed_posts`);
    url.searchParams.set("select", "*");
    url.searchParams.set("post_type", "eq.listing");
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", String(queryLimit));
    if (ignoredProfileIds.length) {
      url.searchParams.set("profile_id", `not.${inFilter(ignoredProfileIds)}`);
    }

    const response = await fetch(url.toString(), {
      headers: getServiceHeaders(env),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error(rows.message || "Não foi possível carregar o feed.");

    const sortedRows = rows
      .map((row) => ({ row, score: getPreferenceScore(row, preferences) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return Date.parse(b.row.created_at || "") - Date.parse(a.row.created_at || "");
      })
      .map((item) => item.row);

    const pageRows = sortedRows.slice(offset, offset + limit);
    const hasMore = pageRows.length > 0 && (sortedRows.length > offset + limit || rows.length >= queryLimit);
    return jsonResponse({
      posts: pageRows.map(toPublicPost),
      hasMore,
      nextOffset: offset + pageRows.length,
    });
  } catch (error) {
    console.error("post feed failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar feed." }, { status: 500 });
  }
}
