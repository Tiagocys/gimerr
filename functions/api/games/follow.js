import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

async function gameExists(env, gameId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/igdb_games`);
  url.searchParams.set("select", "igdb_id");
  url.searchParams.set("igdb_id", `eq.${gameId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar jogo.");
  return rows.length > 0;
}

async function followGame(env, gameId, profileId) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/game_follows?on_conflict=game_igdb_id,profile_id`, {
    method: "POST",
    headers: getServiceHeaders(env, {
      prefer: "resolution=ignore-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      game_igdb_id: gameId,
      profile_id: profileId,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível seguir jogo.");
  }
}

async function unfollowGame(env, gameId, profileId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/game_follows`);
  url.searchParams.set("game_igdb_id", `eq.${gameId}`);
  url.searchParams.set("profile_id", `eq.${profileId}`);

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: getServiceHeaders(env, {
      prefer: "return=minimal",
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível deixar de seguir jogo.");
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const gameId = Number(payload.igdbId || payload.gameId);
    const following = payload.following !== false;

    if (!gameId) {
      return jsonResponse({ error: "Jogo inválido." }, { status: 400 });
    }
    if (!(await gameExists(env, gameId))) {
      return jsonResponse({ error: "Jogo não encontrado." }, { status: 404 });
    }

    if (following) {
      await followGame(env, gameId, auth.user.id);
    } else {
      await unfollowGame(env, gameId, auth.user.id);
    }

    return jsonResponse({ ok: true, following });
  } catch (error) {
    console.error("game follow failed", error);
    return jsonResponse({ error: error?.message || "Falha ao atualizar jogo seguido." }, { status: 500 });
  }
}
