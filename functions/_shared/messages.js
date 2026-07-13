import { getSupabaseRestUrl } from "./auth.js";
import { getServiceHeaders } from "./admin.js";

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
