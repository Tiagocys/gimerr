import { createSystemConversationMessage, fetchRows, GIMERR_SYSTEM_PROFILE_ID, inFilter, mutateRows } from "./messages.js";

function cleanTicketText(value, maxLength = 2000) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export async function createAdminTicket(env, {
  sourceType,
  sourceId,
  requesterId,
  title,
  initialMessage,
}) {
  if (!sourceType || !sourceId || !requesterId) return null;

  const sent = await createSystemConversationMessage(env, requesterId, initialMessage);
  if (!sent?.conversationId) return null;

  const [ticket] = await mutateRows(env, "admin_tickets", {
    params: { on_conflict: "source_type,source_id" },
    body: {
      conversation_id: sent.conversationId,
      source_type: sourceType,
      source_id: sourceId,
      requester_id: requesterId,
      title: cleanTicketText(title, 180) || "Caso Gimerr",
      status: "open",
      reopenable: true,
      user_can_reply: false,
      closed_at: null,
      closed_by: null,
    },
    prefer: "resolution=merge-duplicates,return=representation",
  });

  return { ticket, message: sent.message, conversationId: sent.conversationId };
}

export async function setAdminTicketStatus(env, sourceType, sourceIds, status, options = {}) {
  const ids = Array.isArray(sourceIds) ? sourceIds.filter(Boolean) : [sourceIds].filter(Boolean);
  if (!sourceType || !ids.length || !status) return [];
  const idFilter = ids.length === 1 ? `eq.${ids[0]}` : `in.(${ids.join(",")})`;
  return mutateRows(env, "admin_tickets", {
    method: "PATCH",
    params: {
      source_type: `eq.${sourceType}`,
      source_id: idFilter,
    },
    body: {
      status,
      ...(options.reopenable !== undefined ? { reopenable: Boolean(options.reopenable) } : {}),
      ...(options.userCanReply !== undefined ? { user_can_reply: Boolean(options.userCanReply) } : {}),
      ...(options.closedBy ? { closed_by: options.closedBy, closed_at: new Date().toISOString() } : {}),
    },
  });
}

export async function getRequesterTicketForConversation(env, conversationId, senderId) {
  if (!conversationId || !senderId) return;
  const [ticket] = await fetchRows(env, "admin_tickets", {
    select: "id,requester_id,status,reopenable,user_can_reply",
    conversation_id: `eq.${conversationId}`,
    requester_id: `eq.${senderId}`,
    limit: "1",
  });
  return ticket || null;
}

export async function assertCanReplyToTicket(env, conversationId, senderId) {
  const ticket = await getRequesterTicketForConversation(env, conversationId, senderId);
  if (!ticket) return null;

  if (ticket.status === "closed" || !ticket.reopenable) {
    const error = new Error("Este caso foi encerrado pela equipe do Gimerr.");
    error.status = 403;
    throw error;
  }

  if (!ticket.user_can_reply) {
    const error = new Error("Aguarde a resposta da equipe do Gimerr antes de enviar uma nova mensagem neste caso.");
    error.status = 403;
    throw error;
  }

  return ticket;
}

export async function registerTicketReply(env, conversationId, senderId) {
  const ticket = await getRequesterTicketForConversation(env, conversationId, senderId);
  if (!ticket) return;

  if (ticket.status !== "resolved") return;

  await mutateRows(env, "admin_tickets", {
    method: "PATCH",
    params: { id: `eq.${ticket.id}` },
    body: {
      status: "reopened",
    },
    prefer: "return=minimal",
  });
}

export async function sendAdminTicketSystemMessage(env, sourceType, sourceIds, body) {
  const ids = Array.isArray(sourceIds) ? sourceIds.filter(Boolean) : [sourceIds].filter(Boolean);
  const text = cleanTicketText(body, 2000);
  if (!sourceType || !ids.length || !text) return [];

  const tickets = await fetchRows(env, "admin_tickets", {
    select: "id,conversation_id",
    source_type: `eq.${sourceType}`,
    source_id: ids.length === 1 ? `eq.${ids[0]}` : inFilter(ids),
  });
  if (!tickets.length) return [];

  const now = new Date().toISOString();
  const messages = await mutateRows(env, "conversation_messages", {
    body: tickets.map((ticket) => ({
      conversation_id: ticket.conversation_id,
      sender_id: GIMERR_SYSTEM_PROFILE_ID,
      body: text,
      media_url: null,
      media_key: null,
      media_type: null,
    })),
  });

  await Promise.allSettled(tickets.map((ticket, index) => (
    mutateRows(env, "message_conversations", {
      method: "PATCH",
      params: { id: `eq.${ticket.conversation_id}` },
      body: {
        last_message_at: messages[index]?.created_at || now,
        last_message_sender_id: GIMERR_SYSTEM_PROFILE_ID,
      },
      prefer: "return=minimal",
    })
  )));

  return messages;
}
