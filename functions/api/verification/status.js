import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

async function getDiscordLink(env, userId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profile_platform_links`);
  url.searchParams.set("select", "external_user_id,handle,profile_url");
  url.searchParams.set("profile_id", `eq.${userId}`);
  url.searchParams.set("platform", "eq.discord");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar conexão Discord.");
  return rows[0] || null;
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const profileUrl = new URL(`${getSupabaseRestUrl(env)}/profiles`);
    profileUrl.searchParams.set("select", "id,verification_status,discord_id,discord_verified_at,verification_method,verified_at");
    profileUrl.searchParams.set("id", `eq.${auth.user.id}`);
    profileUrl.searchParams.set("limit", "1");

    const [profileResponse, discordLink] = await Promise.all([
      fetch(profileUrl.toString(), { headers: getServiceHeaders(env) }),
      getDiscordLink(env, auth.user.id),
    ]);
    const profileRows = await profileResponse.json().catch(() => []);
    if (!profileResponse.ok) throw new Error(profileRows.message || "Não foi possível carregar perfil.");

    const profile = profileRows[0] || {};
    const serverInviteUrl = env.DISCORD_INVITE
      || env.DISCORD_INVITE_URL
      || env.DISCORD_OFFICIAL_SERVER_INVITE_URL
      || "";

    return jsonResponse({
      verificationStatus: profile.verification_status || "unverified",
      verified: profile.verification_status === "verified",
      discordLinked: Boolean(profile.discord_id || discordLink?.external_user_id),
      discordHandle: discordLink?.handle || "",
      discordVerifiedAt: profile.discord_verified_at || null,
      verificationMethod: profile.verification_method || "",
      verifiedAt: profile.verified_at || null,
      serverInviteUrl,
      serverInviteConfigured: Boolean(serverInviteUrl),
      verifyChannelName: env.DISCORD_VERIFY_CHANNEL_NAME || "gimerr-verification",
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível carregar verificação.",
    }, { status: 500 });
  }
}
