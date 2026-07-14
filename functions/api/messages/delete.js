import { deleteR2Object, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { cleanUuid, fetchRows, mutateRows, requireConversationParticipant } from "../../_shared/messages.js";

function isReadByOtherParticipants(message, participants, viewerId) {
  const createdAt = new Date(message?.created_at || "");
  if (Number.isNaN(createdAt.getTime())) return false;
  return (participants || []).some((participant) => {
    if (participant.profile_id === viewerId || !participant.last_read_at) return false;
    const readAt = new Date(participant.last_read_at);
    return !Number.isNaN(readAt.getTime()) && readAt >= createdAt;
  });
}

function isOwnedConversationMediaKey(key, ownerId) {
  return String(key || "").startsWith(`conversation-pics/${ownerId}/`);
}

async function refreshConversationLastMessage(env, conversationId) {
  const [latest] = await fetchRows(env, "conversation_messages", {
    select: "id,sender_id,created_at",
    conversation_id: `eq.${conversationId}`,
    status: "eq.active",
    order: "created_at.desc",
    limit: "1",
  });

  await mutateRows(env, "message_conversations", {
    method: "PATCH",
    params: { id: `eq.${conversationId}` },
    body: {
      last_message_at: latest?.created_at || null,
      last_message_sender_id: latest?.sender_id || null,
    },
    prefer: "return=minimal",
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const messageId = cleanUuid(payload.messageId);
    if (!messageId) return jsonResponse({ error: "Mensagem inválida." }, { status: 400 });

    const [message] = await fetchRows(env, "conversation_messages", {
      select: "id,conversation_id,sender_id,created_at,media_key,status",
      id: `eq.${messageId}`,
      status: "eq.active",
      limit: "1",
    });
    if (!message) return jsonResponse({ error: "Mensagem não encontrada." }, { status: 404 });
    if (message.sender_id !== auth.user.id) {
      return jsonResponse({ error: "Você só pode apagar mensagens enviadas por você." }, { status: 403 });
    }

    const ownParticipant = await requireConversationParticipant(env, message.conversation_id, auth.user.id);
    if (!ownParticipant) return jsonResponse({ error: "Conversa não encontrada." }, { status: 404 });

    const participants = await fetchRows(env, "message_conversation_participants", {
      select: "conversation_id,profile_id,last_read_at,created_at",
      conversation_id: `eq.${message.conversation_id}`,
    });

    if (isReadByOtherParticipants(message, participants, auth.user.id)) {
      return jsonResponse({ error: "Essa mensagem já foi lida e não pode mais ser apagada." }, { status: 409 });
    }

    await mutateRows(env, "conversation_messages", {
      method: "PATCH",
      params: { id: `eq.${messageId}` },
      body: {
        status: "deleted",
        body: "Mensagem apagada",
        media_url: null,
        media_key: null,
        media_type: null,
      },
      prefer: "return=minimal",
    });

    if (isOwnedConversationMediaKey(message.media_key, auth.user.id)) {
      await deleteR2Object(env, message.media_key).catch((error) => {
        console.warn("Não foi possível apagar mídia da mensagem.", error);
      });
    }

    await refreshConversationLastMessage(env, message.conversation_id);

    return jsonResponse({ ok: true, messageId });
  } catch (error) {
    console.error("messages delete failed", error);
    return jsonResponse({ error: error?.message || "Falha ao apagar mensagem." }, { status: 500 });
  }
}
