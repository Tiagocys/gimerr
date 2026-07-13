import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

async function getVerification(env, profileId, challenge) {
  const url = new URL(`${getSupabaseRestUrl(env)}/telegram_phone_verifications`);
  url.searchParams.set("select", "id,status,phone_e164,expires_at,verified_at");
  url.searchParams.set("profile_id", `eq.${profileId}`);
  url.searchParams.set("challenge", `eq.${challenge}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível consultar a verificação.");
  return rows[0] || null;
}

async function expireVerification(env, id) {
  const url = new URL(`${getSupabaseRestUrl(env)}/telegram_phone_verifications`);
  url.searchParams.set("id", `eq.${id}`);
  await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env),
    body: JSON.stringify({ status: "expired" }),
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const challenge = String(url.searchParams.get("challenge") || "").trim();
    if (!challenge) {
      return jsonResponse({ error: "Verificação inválida." }, { status: 400 });
    }

    const verification = await getVerification(env, auth.user.id, challenge);
    if (!verification) {
      return jsonResponse({ error: "Verificação não encontrada." }, { status: 404 });
    }

    if (["pending", "awaiting_contact"].includes(verification.status)
      && verification.expires_at
      && new Date(verification.expires_at).getTime() < Date.now()) {
      await expireVerification(env, verification.id);
      return jsonResponse({ ok: true, status: "expired" });
    }

    return jsonResponse({
      ok: true,
      status: verification.status,
      phone: verification.status === "completed" ? verification.phone_e164 : null,
      verifiedAt: verification.verified_at,
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível consultar a verificação.",
    }, { status: 500 });
  }
}
