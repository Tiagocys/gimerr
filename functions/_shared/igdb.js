import { getSupabaseRestUrl } from "./auth.js";

const IGDB_BASE_URL = "https://api.igdb.com/v4";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const GAME_FIELDS = [
  "id",
  "name",
  "slug",
  "summary",
  "first_release_date",
  "updated_at",
  "rating",
  "total_rating",
  "total_rating_count",
  "category",
  "version_parent",
  "alternative_names.name",
  "cover.image_id",
  "genres.name",
  "genres.slug",
  "platforms.name",
  "platforms.abbreviation",
  "websites.url",
  "websites.category",
  "websites.type",
].join(",");

export const POPULARITY_TYPES = {
  igdbVisits: 1,
  wantToPlay: 2,
  steamGlobalTopSellers: 9,
  twitchHoursWatched: 11,
};

export const GIMERR_POPULARITY_WEIGHTS = {
  [POPULARITY_TYPES.igdbVisits]: 0.30,
  [POPULARITY_TYPES.steamGlobalTopSellers]: 0.30,
  [POPULARITY_TYPES.twitchHoursWatched]: 0.25,
  [POPULARITY_TYPES.wantToPlay]: 0.15,
};

let tokenCache = null;

function getIgdbClientId(env) {
  return env.IGDB_CLIENT_ID || env.TWITCH_CLIENT_ID || env.TWITCH_CLIEND_ID;
}

function getIgdbClientSecret(env) {
  return env.IGDB_CLIENT_SECRET || env.TWITCH_CLIENT_SECRET;
}

function getServiceHeaders(env, extra = {}) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente.");
  }

  const role = getJwtRole(key);
  if (role && role !== "service_role") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY precisa ser a chave service_role. A chave atual não tem permissão para importar jogos.");
  }

  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    ...extra,
  };
}

function getJwtRole(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) return "";
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return json.role || "";
  } catch {
    return "";
  }
}

function sanitizeSearch(value) {
  return String(value || "")
    .replace(/["\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizeSearchValue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDate(timestampSeconds) {
  if (!timestampSeconds) return null;
  const date = new Date(Number(timestampSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toIsoDateTime(timestampSeconds) {
  if (!timestampSeconds) return null;
  const date = new Date(Number(timestampSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function getCoverUrl(imageId, size = "cover_big") {
  return imageId ? `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg` : null;
}

function normalizeRelationList(value, fields = ["id", "name", "slug", "abbreviation"]) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => Object.fromEntries(
      fields
        .filter((field) => item[field] !== undefined && item[field] !== null)
        .map((field) => [field, item[field]])
    ));
}

export function normalizeIgdbGame(game, options = {}) {
  const coverImageId = game.cover?.image_id || null;
  return {
    igdb_id: game.id,
    name: game.name || "Jogo sem nome",
    slug: game.slug || null,
    summary: game.summary || null,
    cover_image_id: coverImageId,
    cover_url: getCoverUrl(coverImageId),
    first_release_date: toIsoDate(game.first_release_date),
    igdb_updated_at: toIsoDateTime(game.updated_at),
    rating: game.rating ?? null,
    total_rating: game.total_rating ?? null,
    total_rating_count: game.total_rating_count ?? null,
    category: game.category ?? null,
    version_parent: typeof game.version_parent === "number" ? game.version_parent : null,
    alternative_names: normalizeRelationList(game.alternative_names, ["id", "name"]),
    genres: normalizeRelationList(game.genres, ["id", "name", "slug"]),
    platforms: normalizeRelationList(game.platforms, ["id", "name", "abbreviation"]),
    websites: normalizeRelationList(game.websites, ["id", "url", "category", "type"]),
    popularity: options.popularity || {},
    popularity_score: Number(options.popularityScore || 0),
    imported_from: options.importedFrom || "igdb",
  };
}

export async function getIgdbAccessToken(env) {
  const clientId = getIgdbClientId(env);
  const clientSecret = getIgdbClientSecret(env);

  if (!clientId || !clientSecret) {
    throw new Error("Configure IGDB_CLIENT_ID/IGDB_CLIENT_SECRET ou TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET.");
  }

  if (tokenCache?.accessToken && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const url = new URL(TWITCH_TOKEN_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("grant_type", "client_credentials");

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.message || payload.error_description || payload.error || "Não foi possível autenticar na IGDB.");
  }

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000,
  };
  return tokenCache.accessToken;
}

export async function igdbRequest(env, endpoint, body) {
  const clientId = getIgdbClientId(env);
  const accessToken = await getIgdbAccessToken(env);
  const response = await fetch(`${IGDB_BASE_URL}/${endpoint.replace(/^\/+/, "")}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Client-ID": clientId,
      authorization: `Bearer ${accessToken}`,
    },
    body,
  });

  const payload = await response.json().catch(() => ([]));
  if (!response.ok) {
    throw new Error(Array.isArray(payload)
      ? payload.map((item) => item?.title || item?.cause || item?.message).filter(Boolean).join("; ")
      : payload.message || payload.error || `IGDB retornou ${response.status}.`);
  }

  return payload;
}

export async function searchIgdbGames(env, query, limit = 12) {
  const search = sanitizeSearch(query);
  if (search.length < 2) return [];

  return igdbRequest(
    env,
    "games",
    [
      `search "${search}";`,
      `fields ${GAME_FIELDS};`,
      "where version_parent = null;",
      `limit ${Math.min(Math.max(Number(limit) || 12, 1), 50)};`,
    ].join(" ")
  );
}

export async function searchIgdbTaxonomy(env, type, query = "", limit = 50) {
  const endpoint = type === "platforms" ? "platforms" : "genres";
  const search = sanitizeSearch(query);
  const fields = endpoint === "platforms"
    ? "id,name,slug,abbreviation"
    : "id,name,slug";
  const resultLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const clauses = [
    `fields ${fields};`,
    "sort name asc;",
    `limit ${search.length >= 2 ? 500 : resultLimit};`,
  ];

  const items = await igdbRequest(env, endpoint, clauses.join(" "));
  if (search.length < 2) return items.slice(0, resultLimit);

  const queryText = normalizeSearchValue(search);
  const queryTokens = queryText.split(" ").filter(Boolean);

  function getItemScore(item) {
    const values = [item.name, item.slug, item.abbreviation].filter(Boolean);
    const bestScore = Math.max(...values.map((value) => {
      const text = normalizeSearchValue(value);
      if (!text) return 0;
      if (text === queryText) return 100;
      if (text.startsWith(queryText)) return 80;
      if (queryTokens.every((token) => text.split(" ").some((word) => word.startsWith(token)))) return 60;
      if (text.includes(queryText)) return 40;
      return 0;
    }), 0);
    return bestScore;
  }

  return items
    .map((item) => ({ item, score: getItemScore(item) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.name || "").localeCompare(String(b.item.name || ""), "pt-BR"))
    .slice(0, resultLimit)
    .map(({ item }) => item);
}

export async function getIgdbGamesByIds(env, ids) {
  const cleanIds = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
  if (!cleanIds.length) return [];

  return igdbRequest(
    env,
    "games",
    [
      `fields ${GAME_FIELDS};`,
      `where id = (${cleanIds.join(",")});`,
      `limit ${Math.min(cleanIds.length, 500)};`,
    ].join(" ")
  );
}

export async function getPopularityPrimitives(env, popularityType, limit = 500) {
  return igdbRequest(
    env,
    "popularity_primitives",
    [
      "fields game_id,value,popularity_type,calculated_at,updated_at;",
      `where popularity_type = ${Number(popularityType)};`,
      "sort value desc;",
      `limit ${Math.min(Math.max(Number(limit) || 100, 1), 500)};`,
    ].join(" ")
  );
}

export async function upsertIgdbGames(env, games) {
  if (!games.length) return [];

  const response = await fetch(`${getSupabaseRestUrl(env)}/igdb_games?on_conflict=igdb_id`, {
    method: "POST",
    headers: getServiceHeaders(env, {
      prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify(games),
  });

  const payload = await response.json().catch(() => ([]));
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível salvar jogos IGDB.");
  }

  return payload;
}

export async function upsertPopularityPrimitives(env, primitives) {
  if (!primitives.length) return [];

  const response = await fetch(`${getSupabaseRestUrl(env)}/igdb_popularity_primitives?on_conflict=game_id,popularity_type`, {
    method: "POST",
    headers: getServiceHeaders(env, {
      prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(primitives),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível salvar popularidade IGDB.");
  }

  return [];
}

export async function updateSyncState(env, key, value) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/igdb_sync_state?on_conflict=key`, {
    method: "POST",
    headers: getServiceHeaders(env, {
      prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      key,
      value,
      last_run_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível atualizar estado de sincronização IGDB.");
  }
}

export function calculatePopularityScores(primitivesByType) {
  const scores = new Map();
  const popularityByGame = new Map();

  Object.entries(GIMERR_POPULARITY_WEIGHTS).forEach(([type, weight]) => {
    const primitives = primitivesByType[type] || [];
    const maxValue = Math.max(...primitives.map((primitive) => Number(primitive.value || 0)), 0);
    if (!maxValue) return;

    primitives.forEach((primitive) => {
      const gameId = Number(primitive.game_id);
      const normalizedValue = Number(primitive.value || 0) / maxValue;
      scores.set(gameId, Number(scores.get(gameId) || 0) + normalizedValue * weight);
      const popularity = popularityByGame.get(gameId) || {};
      popularity[type] = Number(primitive.value || 0);
      popularityByGame.set(gameId, popularity);
    });
  });

  return { scores, popularityByGame };
}

export function normalizePopularityPrimitive(primitive) {
  return {
    game_id: Number(primitive.game_id),
    popularity_type: Number(primitive.popularity_type),
    value: Number(primitive.value || 0),
    calculated_at: toIsoDateTime(primitive.calculated_at),
    updated_at: toIsoDateTime(primitive.updated_at) || new Date().toISOString(),
  };
}
