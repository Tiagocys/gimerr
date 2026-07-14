import { jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { cleanUuid, fetchRows, inFilter, markConversationMessageNotificationsRead, requireConversationParticipant, toProfile, touchConversationRead } from "../../_shared/messages.js";

function getReadByOthersAt(participants, viewerId) {
  return (participants || [])
    .filter((participant) => participant.profile_id !== viewerId && participant.last_read_at)
    .map((participant) => new Date(participant.last_read_at))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0]
    ?.toISOString() || "";
}

function toPublicMessage(row, profiles, viewerId, readByOthersAt) {
  const author = toProfile(profiles.get(row.sender_id));
  const readDate = readByOthersAt ? new Date(readByOthersAt) : null;
  const createdAt = new Date(row.created_at);
  const readByOthers = row.sender_id === viewerId
    && readDate
    && !Number.isNaN(readDate.getTime())
    && !Number.isNaN(createdAt.getTime())
    && readDate >= createdAt;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    body: row.body,
    mediaUrl: row.media_url || "",
    mediaType: row.media_type || "",
    createdAt: row.created_at,
    isOwn: row.sender_id === viewerId,
    readByOthers,
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

    const readByOthersAt = getReadByOthersAt(participants, auth.user.id);

    return jsonResponse({
      readByOthersAt,
      participants: participants.map((participant) => ({
        ...participant,
        profile: toProfile(profiles.get(participant.profile_id)),
      })),
      messages: messages.map((message) => toPublicMessage(message, profiles, auth.user.id, readByOthersAt)),
    });
  } catch (error) {
    console.error("messages thread failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar mensagens." }, { status: 500 });
  }
}
