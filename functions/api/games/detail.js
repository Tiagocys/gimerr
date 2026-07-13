import { getSupabaseRestUrl, getSupabaseUrl, jsonResponse } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";
import { fetchIgnoredProfileIds, inFilter } from "../../_shared/ignored-users.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function toPublicGame(game) {
  return {
    igdbId: game.igdb_id,
    name: game.name,
    slug: game.slug,
    summary: game.summary,
    coverUrl: game.cover_url,
    firstReleaseDate: game.first_release_date,
    genres: game.genres || [],
    platforms: game.platforms || [],
    websites: game.websites || [],
    popularityScore: Number(game.popularity_score || 0),
  };
}

function toPublicFollower(row) {
  const profile = row.profile || {};
  return {
    id: profile.id,
    displayName: profile.display_name || profile.username || "Usuário Gimerr",
    username: profile.username,
    avatarUrl: profile.avatar_url,
    followedAt: row.created_at,
  };
}

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
    processingError: row.processing_error,
    createdAt: row.created_at,
    author: {
      id: row.profile_id,
      displayName: row.display_name || row.username || "Usuário Gimerr",
      username: row.username,
      avatarUrl: row.avatar_url,
    },
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

async function fetchGame(env, params) {
  const url = new URL(`${getSupabaseRestUrl(env)}/igdb_games`);
  url.searchParams.set("select", "igdb_id,name,slug,summary,cover_url,first_release_date,genres,platforms,websites,popularity_score");
  url.searchParams.set("limit", "1");

  const id = Number(params.get("id") || params.get("igdbId"));
  const slug = cleanText(params.get("slug"), 120);
  if (id) {
    url.searchParams.set("igdb_id", `eq.${id}`);
  } else if (slug) {
    url.searchParams.set("slug", `eq.${slug}`);
  } else {
    return null;
  }

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar jogo.");
  return rows[0] || null;
}

async function fetchFollowers(env, gameId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/game_follows`);
  url.searchParams.set("select", "created_at,profile:profiles(id,display_name,username,avatar_url)");
  url.searchParams.set("game_igdb_id", `eq.${gameId}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "12");

  const countUrl = new URL(`${getSupabaseRestUrl(env)}/game_follows`);
  countUrl.searchParams.set("select", "game_igdb_id");
  countUrl.searchParams.set("game_igdb_id", `eq.${gameId}`);

  const [response, countResponse] = await Promise.all([
    fetch(url.toString(), { headers: getServiceHeaders(env) }),
    fetch(countUrl.toString(), {
      method: "HEAD",
      headers: getServiceHeaders(env, { prefer: "count=exact" }),
    }),
  ]);
  const rows = await response.json().catch(() => []);

  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar seguidores.");
  if (!countResponse.ok) throw new Error("Não foi possível carregar contador de seguidores.");

  const contentRange = countResponse.headers.get("content-range") || "";
  const followerCount = Number(contentRange.split("/").pop()) || 0;
  return {
    followerCount,
    followers: rows.map(toPublicFollower),
  };
}

async function fetchIsFollowing(env, gameId, userId) {
  if (!userId) return false;

  const url = new URL(`${getSupabaseRestUrl(env)}/game_follows`);
  url.searchParams.set("select", "game_igdb_id");
  url.searchParams.set("game_igdb_id", `eq.${gameId}`);
  url.searchParams.set("profile_id", `eq.${userId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) return false;
  return rows.length > 0;
}

async function fetchGamePosts(env, gameId, ignoredProfileIds = new Set()) {
  const url = new URL(`${getSupabaseRestUrl(env)}/public_feed_posts`);
  url.searchParams.set("select", "*");
  url.searchParams.set("game_igdb_id", `eq.${gameId}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "50");
  const ignoredIds = [...ignoredProfileIds];
  if (ignoredIds.length) {
    url.searchParams.set("profile_id", `not.${inFilter(ignoredIds)}`);
  }

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar posts do jogo.");
  return rows.map(toPublicPost);
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const game = await fetchGame(env, url.searchParams);
    if (!game) {
      return jsonResponse({ error: "Jogo não encontrado." }, { status: 404 });
    }

    const user = await getOptionalAuthUser(request, env);
    const ignoredProfileIds = user?.id ? await fetchIgnoredProfileIds(env, user.id) : new Set();
    const [{ followerCount, followers }, isFollowing, feed] = await Promise.all([
      fetchFollowers(env, game.igdb_id),
      fetchIsFollowing(env, game.igdb_id, user?.id),
      fetchGamePosts(env, game.igdb_id, ignoredProfileIds),
    ]);

    return jsonResponse({
      game: toPublicGame(game),
      followerCount,
      followers,
      isFollowing,
      feed,
    });
  } catch (error) {
    console.error("game detail failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar jogo." }, { status: 500 });
  }
}
