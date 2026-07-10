import { getSupabaseRestUrl, jsonResponse } from "../../_shared/auth.js";
import { normalizeIgdbGame, searchIgdbGames, upsertIgdbGames } from "../../_shared/igdb.js";

function getReadHeaders(env) {
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_ANON_KEY ausente.");
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    accept: "application/json",
  };
}

function sanitizeQuery(value) {
  return String(value || "")
    .replace(/^@/, "")
    .replace(/[%,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAlternativeNameValues(game) {
  return Array.isArray(game.alternative_names)
    ? game.alternative_names.map((item) => item?.name).filter(Boolean)
    : [];
}

function toPublicGame(game) {
  return {
    igdbId: game.igdb_id,
    name: game.name,
    slug: game.slug,
    summary: game.summary,
    coverUrl: game.cover_url,
    firstReleaseDate: game.first_release_date,
    rating: game.rating,
    totalRating: game.total_rating,
    totalRatingCount: game.total_rating_count,
    genres: game.genres || [],
    platforms: game.platforms || [],
    alternativeNames: getAlternativeNameValues(game),
    popularity: game.popularity || {},
    popularityScore: Number(game.popularity_score || 0),
  };
}

function getValueScore(queryText, queryTokens, value) {
  const text = normalizeSearchText(value);
  if (!text) return 0;

  const words = text.split(" ");
  if (text === queryText) return 1000;
  if (text.startsWith(`${queryText} `) || text.startsWith(queryText)) return 900;
  if (words.some((word) => word === queryText)) return 850;
  if (words.some((word) => word.startsWith(queryText))) return 800;
  if (text.includes(` ${queryText} `) || text.includes(` ${queryText}`)) return 700;

  let cursor = 0;
  let orderedMatches = 0;
  for (const token of queryTokens) {
    const nextIndex = words.findIndex((word, index) => index >= cursor && (word === token || word.startsWith(token)));
    if (nextIndex < 0) break;
    orderedMatches += 1;
    cursor = nextIndex + 1;
  }
  if (orderedMatches === queryTokens.length) return 620;

  const includedTokens = queryTokens.filter((token) => words.some((word) => word === token || word.startsWith(token)));
  if (includedTokens.length === queryTokens.length) return 560;

  return 0;
}

function getGameSearchScore(query, game) {
  const queryText = normalizeSearchText(query);
  const queryTokens = queryText.split(" ").filter(Boolean);
  if (!queryText || !queryTokens.length) return 0;

  const values = [
    game.name,
    game.slug,
    ...getAlternativeNameValues(game),
  ];
  const bestTextScore = Math.max(...values.map((value) => getValueScore(queryText, queryTokens, value)), 0);
  if (!bestTextScore) return 0;

  const ratingSignal = Math.min(Number(game.total_rating_count || 0), 1000) / 1000;
  const popularitySignal = Math.min(Number(game.popularity_score || 0), 1);
  return bestTextScore + ratingSignal * 10 + popularitySignal * 20;
}

function rankGames(query, games) {
  return [...games]
    .map((game) => ({ game, score: getGameSearchScore(query, game) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.game.name || "").localeCompare(String(b.game.name || ""), "pt-BR"))
    .map((item) => item.game);
}

async function searchLocalGames(env, query, limit) {
  const queryText = normalizeSearchText(query);
  const url = new URL(`${getSupabaseRestUrl(env)}/igdb_games`);
  url.searchParams.set("select", "igdb_id,name,slug,summary,cover_url,first_release_date,rating,total_rating,total_rating_count,genres,platforms,alternative_names,popularity,popularity_score");
  url.searchParams.set("search_text", `ilike.*${queryText}*`);
  url.searchParams.set("order", "popularity_score.desc,total_rating_count.desc.nullslast,name.asc");
  url.searchParams.set("limit", String(Math.max(limit * 4, 20)));

  const response = await fetch(url.toString(), {
    headers: getReadHeaders(env),
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível buscar jogos locais.");
  }
  return rankGames(query, payload).slice(0, limit);
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const query = sanitizeQuery(url.searchParams.get("q"));
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 20);
    const forceRemote = url.searchParams.get("force") === "1";

    if (query.length < 2) {
      return jsonResponse({ games: [], source: "local" });
    }

    let games = await searchLocalGames(env, query, limit);
    let source = "local";

    if (forceRemote || games.length === 0) {
      const igdbGamesById = new Map();
      const igdbGames = await searchIgdbGames(env, query, limit);
      igdbGames.forEach((game) => igdbGamesById.set(game.id, game));

      const normalized = [...igdbGamesById.values()]
        .map((game) => normalizeIgdbGame(game, { importedFrom: forceRemote ? "igdb_forced_search" : "igdb_search" }));
      const rankedNormalized = rankGames(query, normalized)
        .slice(0, limit);

      if (rankedNormalized.length) {
        await upsertIgdbGames(env, rankedNormalized);
        games = await searchLocalGames(env, query, limit);
        source = "igdb";
      }
    }

    return jsonResponse({
      games: rankGames(query, games).map(toPublicGame),
      source,
    });
  } catch (error) {
    console.error("games search failed", error);
    return jsonResponse({
      error: error?.message || "Não foi possível buscar jogos.",
    }, { status: 500 });
  }
}
