import { jsonResponse } from "../../_shared/auth.js";
import {
  GIMERR_POPULARITY_WEIGHTS,
  calculatePopularityScores,
  getIgdbGamesByIds,
  getPopularityPrimitives,
  normalizeIgdbGame,
  normalizePopularityPrimitive,
  upsertIgdbGames,
  upsertPopularityPrimitives,
  updateSyncState,
} from "../../_shared/igdb.js";

const DEFAULT_LIMIT_PER_TYPE = 250;
const MAX_LIMIT_PER_TYPE = 500;

function isAuthorized(request, env) {
  if (!env.IGDB_SYNC_SECRET) return true;
  return request.headers.get("x-gimerr-sync-secret") === env.IGDB_SYNC_SECRET;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function importPopularGames(env, options = {}) {
  const limitPerType = Math.min(
    Math.max(Number(options.limitPerType) || DEFAULT_LIMIT_PER_TYPE, 1),
    MAX_LIMIT_PER_TYPE
  );
  const primitivesByType = {};
  const allPrimitives = [];

  for (const type of Object.keys(GIMERR_POPULARITY_WEIGHTS)) {
    const primitives = await getPopularityPrimitives(env, Number(type), limitPerType);
    primitivesByType[type] = primitives;
    allPrimitives.push(...primitives.map(normalizePopularityPrimitive));
  }

  const { scores, popularityByGame } = calculatePopularityScores(primitivesByType);
  const gameIds = [...scores.keys()];
  const normalizedGames = [];

  for (const idChunk of chunk(gameIds, 500)) {
    const games = await getIgdbGamesByIds(env, idChunk);
    normalizedGames.push(...games.map((game) => normalizeIgdbGame(game, {
      importedFrom: "igdb_popular",
      popularity: popularityByGame.get(Number(game.id)) || {},
      popularityScore: scores.get(Number(game.id)) || 0,
    })));
  }

  const savedGames = await upsertIgdbGames(env, normalizedGames);
  await upsertPopularityPrimitives(env, allPrimitives.filter((primitive) => gameIds.includes(primitive.game_id)));
  await updateSyncState(env, "igdb_popular_daily", {
    limitPerType,
    gameCount: normalizedGames.length,
    primitiveCount: allPrimitives.length,
    weights: GIMERR_POPULARITY_WEIGHTS,
  });

  return {
    gameCount: savedGames.length || normalizedGames.length,
    primitiveCount: allPrimitives.length,
    limitPerType,
    weights: GIMERR_POPULARITY_WEIGHTS,
  };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: "Não autorizado." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const result = await importPopularGames(env, body);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    console.error("igdb popular import failed", error);
    return jsonResponse({
      error: error?.message || "Não foi possível importar jogos populares.",
    }, { status: 500 });
  }
}

export async function onRequestGet({ request, env }) {
  return onRequestPost({ request, env });
}
