import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function getTelegramToken(env) {
  return env.TELEGRAM_BOT_TOKEN || env.telegram_bot_token || env.TELEGRAM_TOKEN || env.telegram_token || "";
}

function randomChallenge() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 32);
}

async function getBotUsername(env) {
  if (env.TELEGRAM_BOT_USERNAME) return String(env.TELEGRAM_BOT_USERNAME).replace(/^@/, "");

  const token = getTelegramToken(env);
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN ausente.");

  const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok || !payload?.result?.username) {
    throw new Error("Não foi possível identificar o bot do Telegram.");
  }
  return payload.result.username;
}

async function expirePreviousSessions(env, profileId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/telegram_phone_verifications`);
  url.searchParams.set("profile_id", `eq.${profileId}`);
  url.searchParams.set("status", "in.(pending,awaiting_contact)");
  await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env),
    body: JSON.stringify({ status: "expired" }),
  });
}

async function createSession(env, profileId) {
  const challenge = randomChallenge();
  const response = await fetch(`${getSupabaseRestUrl(env)}/telegram_phone_verifications`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify({
      profile_id: profileId,
      challenge,
      status: "pending",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível iniciar a verificação.");
  return rows[0];
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    await expirePreviousSessions(env, auth.user.id);
    const [session, botUsername] = await Promise.all([
      createSession(env, auth.user.id),
      getBotUsername(env),
    ]);

    return jsonResponse({
      ok: true,
      challenge: session.challenge,
      expiresAt: session.expires_at,
      url: `https://t.me/${botUsername}?start=verify_${session.challenge}`,
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível iniciar a verificação pelo Telegram.",
    }, { status: 500 });
  }
}
