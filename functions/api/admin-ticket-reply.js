import { jsonResponse } from "../_shared/auth.js";
import { requireAdminUser } from "../_shared/admin.js";
import { cleanMessageText, mutateRows, GIMERR_SYSTEM_PROFILE_ID } from "../_shared/messages.js";

function cleanText(value, maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function onRequestPost({ request, env }) {
  try {
    const admin = await requireAdminUser(request, env);
    if (admin.error) return admin.error;

    const payload = await request.json().catch(() => ({}));
    const ticketId = cleanText(payload.ticketId, 80);
    const body = cleanMessageText(payload.body, 2000);
    if (!ticketId) return jsonResponse({ error: "Caso inválido." }, { status: 400 });
    if (!body) return jsonResponse({ error: "Escreva a mensagem para o usuário." }, { status: 400 });

    const [ticket] = await mutateRows(env, "admin_tickets", {
      method: "PATCH",
      params: { id: `eq.${ticketId}`, status: "neq.closed" },
      body: {
        status: "open",
        reopenable: true,
        user_can_reply: true,
      },
    });
    if (!ticket) return jsonResponse({ error: "Caso não encontrado ou já encerrado." }, { status: 404 });

    const [message] = await mutateRows(env, "conversation_messages", {
      body: {
        conversation_id: ticket.conversation_id,
        sender_id: GIMERR_SYSTEM_PROFILE_ID,
        body,
        media_url: null,
        media_key: null,
        media_type: null,
      },
    });
    const now = new Date().toISOString();
    await mutateRows(env, "message_conversations", {
      method: "PATCH",
      params: { id: `eq.${ticket.conversation_id}` },
      body: {
        last_message_at: message?.created_at || now,
        last_message_sender_id: GIMERR_SYSTEM_PROFILE_ID,
      },
      prefer: "return=minimal",
    });

    return jsonResponse({ ok: true, ticket, message });
  } catch (error) {
    console.error("admin ticket reply failed", error);
    return jsonResponse({ error: error?.message || "Falha ao responder caso." }, { status: 500 });
  }
}
