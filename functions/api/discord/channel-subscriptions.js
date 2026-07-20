import { getSupabaseRestUrl, jsonResponse } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";
import { cleanDiscordId, cleanDiscordText, validateBotRequest } from "../../_shared/discord_verification.js";

const CONTENT_TYPES = new Set(["post", "listing"]);
const DISCORD_PERMISSION_ADMINISTRATOR = 0x8n;
const DISCORD_PERMISSION_MANAGE_CHANNELS = 0x10n;
const DISCORD_PERMISSION_MANAGE_GUILD = 0x20n;

function cleanText(value, maxLength = 200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
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

function parsePermissions(value) {
  try {
    return BigInt(String(value || "0"));
  } catch {
    return 0n;
  }
}

function canConfigureChannel(permissions) {
  const bits = parsePermissions(permissions);
  return (bits & DISCORD_PERMISSION_ADMINISTRATOR) === DISCORD_PERMISSION_ADMINISTRATOR
    || (bits & DISCORD_PERMISSION_MANAGE_CHANNELS) === DISCORD_PERMISSION_MANAGE_CHANNELS
    || (bits & DISCORD_PERMISSION_MANAGE_GUILD) === DISCORD_PERMISSION_MANAGE_GUILD;
}

function getGameScore(query, game) {
  const queryText = normalizeSearchText(query);
  const name = normalizeSearchText(game?.name);
  const slug = normalizeSearchText(game?.slug);
  if (!queryText || !name) return 0;
  if (String(game?.igdb_id) === queryText) return 1200;
  if (name === queryText) return 1000;
  if (name.startsWith(queryText)) return 900;
  if (slug === queryText) return 850;
  if (name.includes(` ${queryText}`)) return 780;
  if (name.includes(queryText)) return 650;
  return 0;
}

async function fetchRows(env, table, params) {
  const url = new URL(`${getSupabaseRestUrl(env)}/${table}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || `Não foi possível carregar ${table}.`);
  return rows;
}

async function fetchProfileByDiscordId(env, discordId) {
  const directRows = await fetchRows(env, "profiles", {
    select: "id,display_name,username,status,discord_id",
    discord_id: `eq.${discordId}`,
    limit: "1",
  });
  if (directRows[0]) return directRows[0];

  const linkRows = await fetchRows(env, "profile_platform_links", {
    select: "profile_id",
    platform: "eq.discord",
    external_user_id: `eq.${discordId}`,
    limit: "1",
  });
  const profileId = linkRows[0]?.profile_id;
  if (!profileId) return null;

  const profileRows = await fetchRows(env, "profiles", {
    select: "id,display_name,username,status,discord_id",
    id: `eq.${profileId}`,
    limit: "1",
  });
  return profileRows[0] || null;
}

async function findGame(env, gameQuery) {
  const query = cleanText(gameQuery, 100);
  const numericId = Number(query);
  const urlParams = {
    select: "igdb_id,name,slug,cover_url,popularity_score,total_rating_count",
    limit: "12",
  };
  if (Number.isFinite(numericId) && numericId > 0) {
    urlParams.igdb_id = `eq.${numericId}`;
  } else {
    const search = normalizeSearchText(query);
    if (!search || search.length < 2) return { game: null, matches: [] };
    urlParams.search_text = `ilike.*${search.replace(/[%,()]/g, " ")}*`;
    urlParams.order = "popularity_score.desc,total_rating_count.desc.nullslast,name.asc";
  }

  const rows = await fetchRows(env, "igdb_games", urlParams);
  const matches = [...rows]
    .map((game) => ({ game, score: getGameScore(query, game) }))
    .filter((item) => Number.isFinite(numericId) || item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.game?.popularity_score || 0) - Number(a.game?.popularity_score || 0))
    .map((item) => item.game);
  return { game: matches[0] || null, matches };
}

async function upsertSubscription(env, payload) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/discord_channel_subscriptions?on_conflict=guild_id,channel_id,game_igdb_id,content_type`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível salvar a configuração do canal.");
  return rows[0];
}

async function removeSubscription(env, filters) {
  const url = new URL(`${getSupabaseRestUrl(env)}/discord_channel_subscriptions`);
  Object.entries(filters).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify({
      enabled: false,
    }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível remover a configuração do canal.");
  return rows;
}

async function listSubscriptions(env, guildId, channelId) {
  const subscriptions = await fetchRows(env, "discord_channel_subscriptions", {
    select: "id,guild_id,guild_name,channel_id,channel_name,game_igdb_id,content_type,enabled",
    guild_id: `eq.${guildId}`,
    channel_id: `eq.${channelId}`,
    content_type: "eq.listing",
    enabled: "eq.true",
    order: "created_at.desc",
    limit: "20",
  });
  const ids = [...new Set(subscriptions.map((row) => row.game_igdb_id).filter(Boolean))];
  if (!ids.length) return subscriptions;

  const games = await fetchRows(env, "igdb_games", {
    select: "igdb_id,name,slug",
    igdb_id: `in.(${ids.join(",")})`,
    limit: String(ids.length),
  });
  const gamesById = new Map(games.map((game) => [String(game.igdb_id), game]));
  return subscriptions.map((row) => ({
    ...row,
    game: gamesById.get(String(row.game_igdb_id)) || null,
  }));
}

function mapContentType(value) {
  const text = cleanText(value, 40).toLowerCase();
  if (["anuncio", "anuncios", "anúncio", "anúncios", "marketplace", "listing", "listings"].includes(text)) return "listing";
  if (["post", "posts", "publicacao", "publicacoes", "publicação", "publicações"].includes(text)) return "post";
  return CONTENT_TYPES.has(text) ? text : "";
}

function toPublicSubscription(row, game) {
  return {
    id: row.id,
    guildId: row.guild_id,
    guildName: row.guild_name,
    channelId: row.channel_id,
    channelName: row.channel_name,
    gameId: row.game_igdb_id,
    gameName: game?.name || row.game?.name || "",
    contentType: row.content_type,
    enabled: Boolean(row.enabled),
  };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!validateBotRequest(request, env)) {
      return jsonResponse({ error: "Bot não autorizado." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const action = cleanText(body.action, 40).toLowerCase();
    const discordId = cleanDiscordId(body.discordUserId);
    const guildId = cleanDiscordId(body.guildId);
    const channelId = cleanDiscordId(body.channelId);
    const contentType = mapContentType(body.contentType);

    if (!discordId || !guildId || !channelId) {
      return jsonResponse({ error: "Discord, servidor ou canal inválido." }, { status: 400 });
    }
    if (!canConfigureChannel(body.memberPermissions)) {
      return jsonResponse({ error: "Você precisa ter permissão de administrar servidor ou canais para configurar o Gimerr aqui." }, { status: 403 });
    }
    if (action === "status") {
      const subscriptions = await listSubscriptions(env, guildId, channelId);
      return jsonResponse({ subscriptions: subscriptions.map((row) => toPublicSubscription(row)) });
    }
    if (!contentType) {
      return jsonResponse({ error: "Tipo inválido. Use anúncios ou posts." }, { status: 400 });
    }

    const profile = await fetchProfileByDiscordId(env, discordId);
    if (!profile?.id || profile.status !== "active") {
      return jsonResponse({ error: "Conecte este Discord ao seu perfil Gimerr ativo antes de configurar canais." }, { status: 403 });
    }

    const { game, matches } = await findGame(env, body.gameQuery || body.gameId);
    if (!game?.igdb_id) {
      return jsonResponse({ error: "Não encontrei esse jogo na base do Gimerr.", matches: [] }, { status: 404 });
    }
    if (matches.length > 1 && getGameScore(body.gameQuery || body.gameId, matches[0]) < 850) {
      return jsonResponse({
        error: `Encontrei mais de um jogo. Tente usar o nome completo. Primeiro resultado: ${matches[0].name}.`,
        matches: matches.slice(0, 5).map((item) => ({ id: item.igdb_id, name: item.name })),
      }, { status: 409 });
    }

    if (action === "remove") {
      const rows = await removeSubscription(env, {
        guild_id: `eq.${guildId}`,
        channel_id: `eq.${channelId}`,
        game_igdb_id: `eq.${game.igdb_id}`,
        content_type: `eq.${contentType}`,
      });
      return jsonResponse({
        removed: rows.length,
        game: { id: game.igdb_id, name: game.name },
        contentType,
      });
    }

    if (action !== "configure") {
      return jsonResponse({ error: "Ação inválida." }, { status: 400 });
    }

    const subscription = await upsertSubscription(env, {
      guild_id: guildId,
      guild_name: cleanDiscordText(body.guildName, 120),
      channel_id: channelId,
      channel_name: cleanDiscordText(body.channelName, 120),
      game_igdb_id: game.igdb_id,
      content_type: contentType,
      configured_by: profile.id,
      configured_by_discord_id: discordId,
      enabled: true,
    });

    return jsonResponse({
      subscription: toPublicSubscription(subscription, game),
      game: { id: game.igdb_id, name: game.name },
      contentType,
    });
  } catch (error) {
    console.error("discord channel subscription failed", error);
    return jsonResponse({
      error: error?.message || "Não foi possível configurar o canal do Discord.",
    }, { status: 500 });
  }
}
