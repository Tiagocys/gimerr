import { getSupabaseRestUrl } from "./auth.js";
import { getServiceHeaders } from "./admin.js";

export const GIMERR_SYSTEM_PROFILE_ID = "00000000-0000-4000-8000-000000000001";

export function cleanMessageText(value, maxLength = 2000) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

export function cleanUuid(value) {
  const text = String(value || "").trim();
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
}

export function inFilter(values) {
  return `in.(${[...new Set(values.filter(Boolean))].join(",")})`;
}

export function toProfile(row) {
  if (!row?.id) return null;
  return {
    id: row.id,
    displayName: row.display_name || row.username || "Usuário Gimerr",
    username: row.username || "",
    avatarUrl: row.avatar_url || "",
  };
}

export async function fetchRows(env, path, params = {}) {
  const url = new URL(`${getSupabaseRestUrl(env)}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    const error = new Error(rows.message || `Falha ao carregar ${path}.`);
    error.status = response.status;
    error.path = path;
    error.details = rows.details || rows.hint || rows.code || "";
    throw error;
  }
  return rows;
}

export async function mutateRows(env, path, { method = "POST", params = {}, body = {}, prefer = "return=representation" } = {}) {
  const url = new URL(`${getSupabaseRestUrl(env)}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url.toString(), {
    method,
    headers: getServiceHeaders(env, { prefer }),
    body: JSON.stringify(body),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    const error = new Error(rows.message || `Falha ao salvar ${path}.`);
    error.status = response.status;
    error.path = path;
    error.details = rows.details || rows.hint || rows.code || "";
    throw error;
  }
  return rows;
}

export async function requireConversationParticipant(env, conversationId, profileId) {
  const rows = await fetchRows(env, "message_conversation_participants", {
    select: "conversation_id,profile_id,last_read_at",
    conversation_id: `eq.${conversationId}`,
    profile_id: `eq.${profileId}`,
    limit: "1",
  });
  return rows[0] || null;
}

export async function touchConversationRead(env, conversationId, profileId) {
  await mutateRows(env, "message_conversation_participants", {
    method: "PATCH",
    params: {
      conversation_id: `eq.${conversationId}`,
      profile_id: `eq.${profileId}`,
    },
    body: {
      last_read_at: new Date().toISOString(),
    },
    prefer: "return=minimal",
  });
}

export async function markConversationMessageNotificationsRead(env, conversationId, profileId) {
  await mutateRows(env, "notifications", {
    method: "PATCH",
    params: {
      recipient_id: `eq.${profileId}`,
      type: "eq.direct_message",
      read_at: "is.null",
      "data->>conversation_id": `eq.${conversationId}`,
    },
    body: {
      read_at: new Date().toISOString(),
    },
    prefer: "return=minimal",
  });
}

export async function findDirectConversation(env, firstProfileId, secondProfileId) {
  if (!firstProfileId || !secondProfileId || firstProfileId === secondProfileId) return null;

  const secondParticipants = await fetchRows(env, "message_conversation_participants", {
    select: "conversation_id",
    profile_id: `eq.${secondProfileId}`,
    limit: "200",
  });
  const secondConversationIds = secondParticipants.map((row) => row.conversation_id).filter(Boolean);
  if (!secondConversationIds.length) return null;

  const firstParticipants = await fetchRows(env, "message_conversation_participants", {
    select: "conversation_id",
    profile_id: `eq.${firstProfileId}`,
    conversation_id: inFilter(secondConversationIds),
  });

  const commonIds = firstParticipants.map((row) => row.conversation_id).filter(Boolean);
  if (!commonIds.length) return null;

  const rows = await fetchRows(env, "message_conversations", {
    select: "id,conversation_type,created_at",
    id: inFilter(commonIds),
    conversation_type: "eq.direct",
    listing_post_id: "is.null",
    status: "eq.active",
    limit: "1",
  });
  return rows[0] || null;
}

export async function ensureDirectConversation(env, firstProfileId, secondProfileId, createdBy = firstProfileId) {
  const existing = await findDirectConversation(env, firstProfileId, secondProfileId);
  if (existing?.id) return existing.id;

  const [conversation] = await mutateRows(env, "message_conversations", {
    body: {
      conversation_type: "direct",
      listing_post_id: null,
      created_by: createdBy || firstProfileId,
    },
  });

  await mutateRows(env, "message_conversation_participants", {
    body: [
      { conversation_id: conversation.id, profile_id: firstProfileId, last_read_at: new Date().toISOString() },
      { conversation_id: conversation.id, profile_id: secondProfileId, last_read_at: null },
    ],
  });

  return conversation.id;
}

export async function sendSystemMessage(env, recipientId, body) {
  if (!recipientId) return null;
  const text = cleanMessageText(body, 2000);
  if (!text) return null;

  const conversationId = await ensureDirectConversation(
    env,
    GIMERR_SYSTEM_PROFILE_ID,
    recipientId,
    GIMERR_SYSTEM_PROFILE_ID,
  );

  const [message] = await mutateRows(env, "conversation_messages", {
    body: {
      conversation_id: conversationId,
      sender_id: GIMERR_SYSTEM_PROFILE_ID,
      body: text,
      media_url: null,
      media_key: null,
      media_type: null,
    },
  });
  const now = new Date().toISOString();
  await mutateRows(env, "message_conversations", {
    method: "PATCH",
    params: { id: `eq.${conversationId}` },
    body: {
      last_message_at: message?.created_at || now,
      last_message_sender_id: GIMERR_SYSTEM_PROFILE_ID,
    },
    prefer: "return=minimal",
  });

  return { conversationId, message };
}

export async function createSystemConversationMessage(env, recipientId, body) {
  if (!recipientId) return null;
  const text = cleanMessageText(body, 2000);
  if (!text) return null;

  const [conversation] = await mutateRows(env, "message_conversations", {
    body: {
      conversation_type: "direct",
      listing_post_id: null,
      created_by: GIMERR_SYSTEM_PROFILE_ID,
    },
  });

  const now = new Date().toISOString();
  await mutateRows(env, "message_conversation_participants", {
    body: [
      { conversation_id: conversation.id, profile_id: GIMERR_SYSTEM_PROFILE_ID, last_read_at: now },
      { conversation_id: conversation.id, profile_id: recipientId, last_read_at: null },
    ],
  });

  const [message] = await mutateRows(env, "conversation_messages", {
    body: {
      conversation_id: conversation.id,
      sender_id: GIMERR_SYSTEM_PROFILE_ID,
      body: text,
      media_url: null,
      media_key: null,
      media_type: null,
    },
  });

  await mutateRows(env, "message_conversations", {
    method: "PATCH",
    params: { id: `eq.${conversation.id}` },
    body: {
      last_message_at: message?.created_at || now,
      last_message_sender_id: GIMERR_SYSTEM_PROFILE_ID,
    },
    prefer: "return=minimal",
  });

  return { conversationId: conversation.id, message };
}
