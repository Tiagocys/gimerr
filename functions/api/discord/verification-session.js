import { getSupabaseRestUrl, jsonResponse } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";
import {
  cleanDiscordId,
  cleanDiscordText,
  getPublicBaseUrl,
  makeVerificationToken,
  sha256Hex,
  validateBotRequest,
} from "../../_shared/discord_verification.js";

async function expirePreviousSessions(env, discordId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/discord_verification_sessions`);
  url.searchParams.set("discord_id", `eq.${discordId}`);
  url.searchParams.set("status", "eq.pending");

  await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env),
    body: JSON.stringify({
      status: "expired",
    }),
  });
}

async function insertSession(env, payload) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/discord_verification_sessions`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível criar a sessão de verificação.");
  return rows[0];
}

export async function onRequestPost({ request, env }) {
  try {
    if (!validateBotRequest(request, env)) {
      return jsonResponse({ error: "Bot não autorizado." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const discordId = cleanDiscordId(body.discordId);
    const discordUsername = cleanDiscordText(body.discordUsername, 80);
    if (!discordId) {
      return jsonResponse({ error: "Discord inválido." }, { status: 400 });
    }

    await expirePreviousSessions(env, discordId);

    const token = makeVerificationToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const session = await insertSession(env, {
      discord_id: discordId,
      discord_username: discordUsername || null,
      token_hash: tokenHash,
      status: "pending",
      expires_at: expiresAt,
    });

    return jsonResponse({
      ok: true,
      expiresAt: session.expires_at,
      verifyUrl: `${getPublicBaseUrl(request, env)}/discord-verify.html?token=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível criar a verificação.",
    }, { status: 500 });
  }
}
