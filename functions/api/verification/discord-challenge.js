import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let suffix = "";
  bytes.forEach((byte) => {
    suffix += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  });
  return `GM${suffix}`;
}

function displayCode(code) {
  return `${code.slice(0, 2)}-${code.slice(2)}`;
}

async function fetchDiscordLink(env, userId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profile_platform_links`);
  url.searchParams.set("select", "external_user_id,handle");
  url.searchParams.set("profile_id", `eq.${userId}`);
  url.searchParams.set("platform", "eq.discord");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar Discord.");
  return rows[0] || null;
}

async function expirePreviousChallenges(env, userId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/discord_verification_challenges`);
  url.searchParams.set("profile_id", `eq.${userId}`);
  url.searchParams.set("status", "eq.pending");

  await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env),
    body: JSON.stringify({
      status: "expired",
    }),
  });
}

async function insertChallenge(env, payload) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/discord_verification_challenges`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível criar código de verificação.");
  return rows[0];
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const profileUrl = new URL(`${getSupabaseRestUrl(env)}/profiles`);
    profileUrl.searchParams.set("select", "id,verification_status,discord_id");
    profileUrl.searchParams.set("id", `eq.${auth.user.id}`);
    profileUrl.searchParams.set("limit", "1");

    const [profileResponse, discordLink] = await Promise.all([
      fetch(profileUrl.toString(), { headers: getServiceHeaders(env) }),
      fetchDiscordLink(env, auth.user.id),
    ]);
    const profileRows = await profileResponse.json().catch(() => []);
    if (!profileResponse.ok) throw new Error(profileRows.message || "Não foi possível carregar perfil.");

    const profile = profileRows[0] || {};
    if (profile.verification_status === "verified") {
      return jsonResponse({ verified: true });
    }

    const discordId = profile.discord_id || discordLink?.external_user_id;
    if (!discordId) {
      return jsonResponse({
        error: "Conecte sua conta Discord antes de gerar o código.",
        code: "discord_required",
      }, { status: 409 });
    }

    const updateProfileUrl = new URL(`${getSupabaseRestUrl(env)}/profiles`);
    updateProfileUrl.searchParams.set("id", `eq.${auth.user.id}`);
    await fetch(updateProfileUrl.toString(), {
      method: "PATCH",
      headers: getServiceHeaders(env),
      body: JSON.stringify({
        discord_id: discordId,
        verification_status: "pending",
      }),
    });

    await expirePreviousChallenges(env, auth.user.id);

    const code = makeCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const challenge = await insertChallenge(env, {
      profile_id: auth.user.id,
      discord_id: discordId,
      code,
      status: "pending",
      expires_at: expiresAt,
    });

    const serverInviteUrl = env.DISCORD_INVITE
      || env.DISCORD_INVITE_URL
      || env.DISCORD_OFFICIAL_SERVER_INVITE_URL
      || "";

    return jsonResponse({
      code: displayCode(challenge.code),
      rawCode: challenge.code,
      expiresAt: challenge.expires_at,
      serverInviteUrl,
      serverInviteConfigured: Boolean(serverInviteUrl),
      verifyChannelName: env.DISCORD_VERIFY_CHANNEL_NAME || "gimerr-verification",
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível gerar código de verificação.",
    }, { status: 500 });
  }
}
