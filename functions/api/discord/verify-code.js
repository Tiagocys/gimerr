import { getSupabaseRestUrl, jsonResponse } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function normalizeCode(value) {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (text.startsWith("GM") && text.length >= 8) return text.slice(0, 8);
  const match = text.match(/[A-Z0-9]{6}/);
  return match ? `GM${match[0]}` : "";
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function validateBotRequest(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^bearer\s+/i, "");
  return Boolean(env.DISCORD_BOT_TOKEN && token && token === env.DISCORD_BOT_TOKEN);
}

async function fetchProfileByDiscordId(env, discordId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,verification_status,discord_id,status,suspended_until");
  url.searchParams.set("discord_id", `eq.${discordId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível identificar o usuário.");
  return rows[0] || null;
}

async function fetchChallenge(env, code, discordId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/discord_verification_challenges`);
  url.searchParams.set("select", "id,profile_id,discord_id,status,expires_at");
  url.searchParams.set("code", `eq.${code}`);
  url.searchParams.set("discord_id", `eq.${discordId}`);
  url.searchParams.set("status", "eq.pending");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar código.");
  return rows[0] || null;
}

async function patchById(env, table, id, payload) {
  const url = new URL(`${getSupabaseRestUrl(env)}/${table}`);
  url.searchParams.set("id", `eq.${id}`);
  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || `Não foi possível atualizar ${table}.`);
  return rows[0] || null;
}

async function verifyProfile(env, profileId, discordId) {
  const now = new Date().toISOString();
  return patchById(env, "profiles", profileId, {
    verification_status: "verified",
    verification_method: "discord_server_highest",
    discord_id: discordId,
    discord_verified_at: now,
    verified_at: now,
  });
}

function getProfileRestriction(profile) {
  if (!profile) return "";
  if (profile.status === "banned") return "Esta conta foi banida e não pode ser verificada.";
  if (profile.status === "inactive") return "Esta conta está inativa e não pode ser verificada.";
  if (profile.status === "suspended") {
    const suspendedUntil = profile.suspended_until ? new Date(profile.suspended_until).getTime() : 0;
    if (!suspendedUntil || suspendedUntil > Date.now()) {
      return "Esta conta está suspensa e não pode ser verificada agora.";
    }
  }
  return "";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!validateBotRequest(request, env)) {
      return jsonResponse({ error: "Bot não autorizado." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const discordId = cleanText(body.discordId, 80);
    const code = normalizeCode(body.code || body.content);

    if (!discordId) {
      return jsonResponse({ error: "Discord inválido." }, { status: 400 });
    }

    if (!code) {
      const profile = await fetchProfileByDiscordId(env, discordId);
      if (!profile) {
        return jsonResponse({
          error: "Não encontrei uma conta Gimerr conectada a este Discord. Conecte o Discord no Gimerr e tente novamente.",
        }, { status: 404 });
      }

      const restriction = getProfileRestriction(profile);
      if (restriction) {
        return jsonResponse({ error: restriction }, { status: 403 });
      }

      if (profile.verification_status === "verified") {
        return jsonResponse({
          ok: true,
          alreadyVerified: true,
          profileId: profile.id,
        });
      }

      const verifiedProfile = await verifyProfile(env, profile.id, discordId);
      return jsonResponse({
        ok: true,
        profileId: verifiedProfile?.id || profile.id,
      });
    }

    const challenge = await fetchChallenge(env, code, discordId);
    if (!challenge) {
      return jsonResponse({ error: "Código não encontrado para este Discord." }, { status: 404 });
    }

    const profileByDiscord = await fetchProfileByDiscordId(env, discordId);
    const restriction = getProfileRestriction(profileByDiscord);
    if (restriction) {
      return jsonResponse({ error: restriction }, { status: 403 });
    }

    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      await patchById(env, "discord_verification_challenges", challenge.id, {
        status: "expired",
      });
      return jsonResponse({ error: "Código expirado." }, { status: 410 });
    }

    const now = new Date().toISOString();
    const profile = await verifyProfile(env, challenge.profile_id, discordId);

    await patchById(env, "discord_verification_challenges", challenge.id, {
      status: "used",
      consumed_at: now,
    });

    return jsonResponse({
      ok: true,
      profileId: profile?.id || challenge.profile_id,
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível verificar código.",
    }, { status: 500 });
  }
}
