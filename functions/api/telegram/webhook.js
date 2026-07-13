import { getSupabaseRestUrl, jsonResponse } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function getTelegramToken(env) {
  return env.TELEGRAM_BOT_TOKEN || env.telegram_bot_token || env.TELEGRAM_TOKEN || env.telegram_token || "";
}

function getTelegramWebhookSecret(env) {
  return env.TELEGRAM_WEBHOOK_SECRET || env.telegram_webhook_secret || "";
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

function isValidPhone(phone) {
  return /^\+[1-9][0-9]{7,14}$/.test(phone);
}

async function sendTelegramMessage(env, chatId, text, replyMarkup) {
  const token = getTelegramToken(env);
  if (!token || !chatId) return;

  const payload = {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  };

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function getSessionByChallenge(env, challenge) {
  const url = new URL(`${getSupabaseRestUrl(env)}/telegram_phone_verifications`);
  url.searchParams.set("select", "id,profile_id,status,expires_at");
  url.searchParams.set("challenge", `eq.${challenge}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar o código.");
  return rows[0] || null;
}

async function getSessionByTelegramUser(env, telegramUserId, telegramChatId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/telegram_phone_verifications`);
  url.searchParams.set("select", "id,profile_id,status,expires_at");
  url.searchParams.set("telegram_user_id", `eq.${telegramUserId}`);
  url.searchParams.set("telegram_chat_id", `eq.${telegramChatId}`);
  url.searchParams.set("status", "eq.awaiting_contact");
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar a verificação.");
  return rows[0] || null;
}

async function patchSession(env, id, payload) {
  const url = new URL(`${getSupabaseRestUrl(env)}/telegram_phone_verifications`);
  url.searchParams.set("id", `eq.${id}`);
  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Não foi possível atualizar a verificação.");
}

async function getProfile(env, profileId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,status");
  url.searchParams.set("id", `eq.${profileId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar a conta.");
  return rows[0] || null;
}

async function updateProfilePhone(env, profileId, telegramUserId, phone) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("id", `eq.${profileId}`);
  const now = new Date().toISOString();
  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env),
    body: JSON.stringify({
      phone_e164: phone,
      phone_verified_at: now,
      phone_verification_method: "telegram_bot",
      telegram_user_id: String(telegramUserId),
      phone_is_public: false,
      phone_contact_whatsapp: false,
      phone_contact_telegram: true,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.code === "23505"
      ? "Este telefone ou Telegram já está verificado em outra conta do Gimerr."
      : data.message || "Não foi possível salvar o telefone.";
    const error = new Error(message);
    error.code = data.code;
    throw error;
  }
  return now;
}

async function handleStart(env, message, challenge) {
  const chatId = message.chat?.id;
  const fromId = message.from?.id;
  const session = await getSessionByChallenge(env, challenge);

  if (!session) {
    await sendTelegramMessage(env, chatId, "Código inválido. Volte ao Gimerr e inicie a verificação novamente.");
    return;
  }

  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    await patchSession(env, session.id, { status: "expired" });
    await sendTelegramMessage(env, chatId, "Este código expirou. Volte ao Gimerr e inicie a verificação novamente.");
    return;
  }

  await patchSession(env, session.id, {
    status: "awaiting_contact",
    telegram_user_id: String(fromId),
    telegram_chat_id: String(chatId),
  });

  await sendTelegramMessage(env, chatId, "Toque no botão abaixo para compartilhar seu telefone com o Gimerr.", {
    keyboard: [[{ text: "Compartilhar telefone", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  });
}

async function handleContact(env, message) {
  const chatId = message.chat?.id;
  const fromId = message.from?.id;
  const contact = message.contact;

  if (contact.user_id && String(contact.user_id) !== String(fromId)) {
    await sendTelegramMessage(env, chatId, "Compartilhe o seu próprio contato para verificar a conta.");
    return;
  }

  const session = await getSessionByTelegramUser(env, String(fromId), String(chatId));
  if (!session) {
    await sendTelegramMessage(env, chatId, "Nenhuma verificação pendente encontrada. Volte ao Gimerr e tente novamente.");
    return;
  }

  if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
    await patchSession(env, session.id, { status: "expired" });
    await sendTelegramMessage(env, chatId, "Este código expirou. Volte ao Gimerr e inicie a verificação novamente.");
    return;
  }

  const phone = normalizePhone(contact.phone_number);
  if (!isValidPhone(phone)) {
    await sendTelegramMessage(env, chatId, "Não foi possível validar este telefone. Verifique se o Telegram compartilhou o número com código do país.");
    return;
  }

  const profile = await getProfile(env, session.profile_id);
  if (!profile || profile.status !== "active") {
    await patchSession(env, session.id, { status: "failed" });
    await sendTelegramMessage(env, chatId, "Esta conta não pode verificar telefone no momento.");
    return;
  }

  try {
    const verifiedAt = await updateProfilePhone(env, session.profile_id, fromId, phone);
    await patchSession(env, session.id, {
      status: "completed",
      phone_e164: phone,
      verified_at: verifiedAt,
    });
    await sendTelegramMessage(env, chatId, "Telefone verificado com sucesso. Você já pode voltar ao Gimerr.");
  } catch (error) {
    await patchSession(env, session.id, { status: "failed" });
    await sendTelegramMessage(env, chatId, error.message || "Não foi possível verificar este telefone.");
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const token = getTelegramToken(env);
    if (!token) return jsonResponse({ error: "TELEGRAM_BOT_TOKEN ausente." }, { status: 500 });

    const expectedSecret = getTelegramWebhookSecret(env);
    if (expectedSecret) {
      const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (receivedSecret !== expectedSecret) {
        return jsonResponse({ error: "Webhook inválido." }, { status: 401 });
      }
    }

    const update = await request.json().catch(() => ({}));
    const message = update?.message || update?.edited_message;
    if (!message) return jsonResponse({ ok: true });

    const text = String(message.text || "");
    const startMatch = text.match(/^\/start\s+verify_([a-z0-9]+)$/i);
    if (startMatch) {
      await handleStart(env, message, startMatch[1]);
      return jsonResponse({ ok: true });
    }

    if (message.contact) {
      await handleContact(env, message);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("telegram webhook error", error);
    return jsonResponse({ error: "Erro no webhook do Telegram." }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return jsonResponse({ ok: true });
}
