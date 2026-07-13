import { jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { cleanUuid, fetchRows, inFilter, markConversationMessageNotificationsRead, requireConversationParticipant, toProfile, touchConversationRead } from "../../_shared/messages.js";

function toPublicMessage(row, profiles, viewerId) {
  const author = toProfile(profiles.get(row.sender_id));
  return {
    id: row.id,
    conversationId: row.conversation_id,
    body: row.body,
    mediaUrl: row.media_url || "",
    mediaType: row.media_type || "",
    createdAt: row.created_at,
    isOwn: row.sender_id === viewerId,
    author,
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const conversationId = cleanUuid(url.searchParams.get("conversationId"));
    if (!conversationId) return jsonResponse({ error: "Conversa inválida." }, { status: 400 });

    const ownParticipant = await requireConversationParticipant(env, conversationId, auth.user.id);
    if (!ownParticipant) return jsonResponse({ error: "Conversa não encontrada." }, { status: 404 });

    const [participants, messages] = await Promise.all([
      fetchRows(env, "message_conversation_participants", {
        select: "conversation_id,profile_id,last_read_at,created_at",
        conversation_id: `eq.${conversationId}`,
      }),
      fetchRows(env, "conversation_messages", {
        select: "id,conversation_id,sender_id,body,media_url,media_type,created_at",
        conversation_id: `eq.${conversationId}`,
        status: "eq.active",
        order: "created_at.asc",
        limit: "120",
      }),
    ]);

    const profileIds = [...participants.map((row) => row.profile_id), ...messages.map((row) => row.sender_id)].filter(Boolean);
    const profileRows = profileIds.length
      ? await fetchRows(env, "profiles", {
        select: "id,display_name,username,avatar_url",
        id: inFilter(profileIds),
      })
      : [];
    const profiles = new Map(profileRows.map((profile) => [profile.id, profile]));

    await Promise.allSettled([
      touchConversationRead(env, conversationId, auth.user.id),
      markConversationMessageNotificationsRead(env, conversationId, auth.user.id),
    ]);

    return jsonResponse({
      participants: participants.map((participant) => ({
        ...participant,
        profile: toProfile(profiles.get(participant.profile_id)),
      })),
      messages: messages.map((message) => toPublicMessage(message, profiles, auth.user.id)),
    });
  } catch (error) {
    console.error("messages thread failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar mensagens." }, { status: 500 });
  }
}
