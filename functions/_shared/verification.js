import { getSupabaseRestUrl, jsonResponse } from "./auth.js";
import { getServiceHeaders } from "./admin.js";

export function isVerifiedProfile(profile) {
  return profile?.verification_status === "verified";
}

export async function getProfileVerification(env, userId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,verification_status,discord_id,discord_verified_at,status,phone_e164,phone_verified_at,phone_is_public");
  url.searchParams.set("id", `eq.${userId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar a verificação da conta.");
  return rows[0] || null;
}

export async function requireVerifiedProfile(env, userId) {
  const profile = await getProfileVerification(env, userId);
  if (isVerifiedProfile(profile)) return { profile };

  return {
    error: jsonResponse({
      error: "Verifique sua conta com o Discord para publicar no Gimerr.",
      code: "account_not_verified",
      verificationStatus: profile?.verification_status || "unverified",
      discordLinked: Boolean(profile?.discord_id),
    }, { status: 403 }),
  };
}
