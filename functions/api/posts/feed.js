import { getSupabaseRestUrl, getSupabaseUrl, jsonResponse } from "../../_shared/auth.js";
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

function toPublicGame(game, count = 0, source = "trending") {
  if (!game?.id) return null;
  return {
    id: game.id,
    name: game.name || "Game Gimerr",
    slug: game.slug || "",
    coverUrl: game.coverUrl || game.cover_url || "",
    count: Number(count || 0),
    source,
  };
}

function cleanNumber(value, fallback, { min = 0, max = 20 } = {}) {
  const number = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function sortRankedItems(a, b) {
  if (b.count !== a.count) return b.count - a.count;
  return Date.parse(b.latestAt || "") - Date.parse(a.latestAt || "");
}

async function fetchTrendingGameRows(env) {
  const url = new URL(`${getSupabaseRestUrl(env)}/public_feed_posts`);
  url.searchParams.set("select", "game_igdb_id,game_name,game_slug,game_cover_url,created_at");
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "700");

  const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar destaques do feed.");

  const games = new Map();
  (rows || []).forEach((row) => {
    if (!row.game_igdb_id) return;
    const id = String(row.game_igdb_id);
    const current = games.get(id) || {
      id: row.game_igdb_id,
      name: row.game_name || "Game Gimerr",
      slug: row.game_slug || "",
      coverUrl: row.game_cover_url || "",
      count: 0,
      latestAt: row.created_at,
    };
    current.count += 1;
    if (Date.parse(row.created_at || "") > Date.parse(current.latestAt || "")) current.latestAt = row.created_at;
    games.set(id, current);
  });

  return Array.from(games.values()).sort(sortRankedItems);
}

async function fetchFollowedGameIds(env, profileId) {
  if (!profileId) return new Set();
  const gamesUrl = new URL(`${getSupabaseRestUrl(env)}/game_follows`);
  gamesUrl.searchParams.set("select", "game_igdb_id");
  gamesUrl.searchParams.set("profile_id", `eq.${profileId}`);
  gamesUrl.searchParams.set("order", "created_at.desc");
  gamesUrl.searchParams.set("limit", "500");

  const response = await fetch(gamesUrl.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar jogos seguidos.");
  return new Set((rows || []).map((row) => String(row.game_igdb_id)).filter(Boolean));
}

async function fetchSidebarData(env, profileId, options = {}) {
  const limit = cleanNumber(options.limit, 12, { min: 1, max: 30 });
  const offset = cleanNumber(options.offset, 0, { min: 0, max: 5000 });
  const [trendingRows, followedIds] = await Promise.all([
    fetchTrendingGameRows(env),
    fetchFollowedGameIds(env, profileId),
  ]);

  const sortedGames = trendingRows
    .map((game) => ({
      ...game,
      source: followedIds.has(String(game.id)) ? "followed" : "trending",
    }))
    .sort((a, b) => {
      if (a.source !== b.source) return a.source === "followed" ? -1 : 1;
      return sortRankedItems(a, b);
    });

  const pageRows = sortedGames.slice(offset, offset + limit);
  return {
    mode: profileId ? "authenticated" : "guest",
    games: pageRows.map((game) => toPublicGame(game, game.count, game.source)).filter(Boolean),
    hasMore: sortedGames.length > offset + limit,
    nextOffset: offset + pageRows.length,
    profiles: [],
  };
}

async function fetchPreferenceIds(env, profileId) {
  if (!profileId) {
    return {
      followedGameIds: new Set(),
      recommendedProfileIds: new Set(),
    };
  }

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

async function getOptionalAuthUser(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;

  const supabaseUrl = getSupabaseUrl(env);
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      authorization,
    },
  });
  const user = await response.json().catch(() => null);
  return response.ok ? user : null;
}

function getPreferenceScore(row, preferences) {
  let score = 0;
  if (preferences.followedGameIds.has(String(row.game_igdb_id))) score += 2;
  if (preferences.recommendedProfileIds.has(String(row.profile_id))) score += 1;
  return score;
}

export async function onRequestGet({ request, env }) {
  try {
    const user = await getOptionalAuthUser(request, env);

    const requestUrl = new URL(request.url);
    if (requestUrl.searchParams.get("sidebar") === "1") {
      return jsonResponse(await fetchSidebarData(env, user?.id || "", {
        limit: requestUrl.searchParams.get("sidebarLimit"),
        offset: requestUrl.searchParams.get("sidebarOffset"),
      }));
    }

    const limit = cleanNumber(requestUrl.searchParams.get("limit"), 10, { min: 1, max: 15 });
    const offset = cleanNumber(requestUrl.searchParams.get("offset"), 0, { min: 0, max: 5000 });
    const fetchLimit = limit + 1;
    const queryLimit = Math.min(500, Math.max(fetchLimit, offset + fetchLimit + 60));
    const ignoredProfileIds = user?.id ? [...(await fetchIgnoredProfileIds(env, user.id))] : [];
    const preferences = await fetchPreferenceIds(env, user?.id || "");

    const url = new URL(`${getSupabaseRestUrl(env)}/public_feed_posts`);
    url.searchParams.set("select", "*");
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
