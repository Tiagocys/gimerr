import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";
import { sha256Hex } from "../../_shared/discord_verification.js";

function getDiscordIdentity(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return identities.find((identity) => {
    const provider = String(identity?.provider || identity?.identity_data?.provider || "").toLowerCase();
    return provider === "discord";
  }) || null;
}

function getDiscordIdentityId(identity) {
  const data = identity?.identity_data || {};
  return String(data.provider_id || data.sub || data.id || identity?.id || identity?.identity_id || "")
    .replace(/\D+/g, "");
}

function getDiscordHandle(identity) {
  const data = identity?.identity_data || {};
  const name = data.full_name || data.name || data.global_name || data.user_name || data.preferred_username;
  return name ? `@${String(name).replace(/^@+/, "")}` : "@discord";
}

function getProfileRestriction(profile) {
  if (!profile) return "Perfil não encontrado.";
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

async function fetchSession(env, tokenHash) {
  const url = new URL(`${getSupabaseRestUrl(env)}/discord_verification_sessions`);
  url.searchParams.set("select", "id,discord_id,status,expires_at");
  url.searchParams.set("token_hash", `eq.${tokenHash}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar a sessão.");
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

async function fetchProfile(env, profileId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,status,suspended_until");
  url.searchParams.set("id", `eq.${profileId}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar o perfil.");
  return rows[0] || null;
}

async function upsertDiscordLink(env, auth, identity, discordId) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/profile_platform_links?on_conflict=profile_id,platform`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({
      profile_id: auth.user.id,
      platform: "discord",
      handle: getDiscordHandle(identity),
      profile_url: `https://discord.com/users/${discordId}`,
      external_user_id: discordId,
      is_public: true,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível salvar o Discord no perfil.");
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const token = String(body.token || "").trim();
    if (!token) {
      return jsonResponse({ error: "Token de verificação ausente." }, { status: 400 });
    }

    const identity = getDiscordIdentity(auth.user);
    const discordId = getDiscordIdentityId(identity);
    if (!discordId) {
      return jsonResponse({
        error: "Entre no Gimerr usando Discord para concluir esta verificação.",
        code: "discord_login_required",
      }, { status: 409 });
    }

    const session = await fetchSession(env, await sha256Hex(token));
    if (!session || session.status !== "pending") {
      return jsonResponse({ error: "Sessão de verificação inválida ou já usada." }, { status: 404 });
    }
    if (new Date(session.expires_at).getTime() < Date.now()) {
      await patchById(env, "discord_verification_sessions", session.id, { status: "expired" });
      return jsonResponse({ error: "Sessão de verificação expirada. Clique novamente no botão do Discord." }, { status: 410 });
    }
    if (session.discord_id !== discordId) {
      return jsonResponse({
        error: "O Discord autenticado no Gimerr não é o mesmo Discord que clicou no botão de verificação.",
      }, { status: 403 });
    }

    const profile = await fetchProfile(env, auth.user.id);
    const restriction = getProfileRestriction(profile);
    if (restriction) {
      return jsonResponse({ error: restriction }, { status: 403 });
    }

    const now = new Date().toISOString();
    await upsertDiscordLink(env, auth, identity, discordId);
    await patchById(env, "profiles", auth.user.id, {
      verification_status: "verified",
      verification_method: "discord_server_highest",
      discord_id: discordId,
      discord_verified_at: now,
      verified_at: now,
    });
    await patchById(env, "discord_verification_sessions", session.id, {
      status: "used",
      consumed_by: auth.user.id,
      consumed_at: now,
    });

    return jsonResponse({
      ok: true,
      verificationStatus: "verified",
      verificationMethod: "discord_server_highest",
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível concluir a verificação.",
    }, { status: 500 });
  }
}
