import { jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { fetchRows, inFilter } from "../../_shared/messages.js";
import { fetchIgnoredProfileIds } from "../../_shared/ignored-users.js";

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env, { allowRestricted: true });
    if (auth.error) return auth.error;

    const [ownParticipants, ignoredProfileIds] = await Promise.all([
      fetchRows(env, "message_conversation_participants", {
        select: "conversation_id,last_read_at",
        profile_id: `eq.${auth.user.id}`,
        limit: "200",
      }),
      fetchIgnoredProfileIds(env, auth.user.id),
    ]);
    const conversationIds = ownParticipants.map((row) => row.conversation_id).filter(Boolean);
    if (!conversationIds.length) return jsonResponse({ unreadCount: 0 });

    const conversations = await fetchRows(env, "message_conversations", {
      select: "id,last_message_at,last_message_sender_id,status",
      id: inFilter(conversationIds),
      status: "eq.active",
    });
    const readByConversation = new Map(ownParticipants.map((row) => [row.conversation_id, row.last_read_at]));
    const unreadCount = conversations.reduce((total, conversation) => {
      if (!conversation.last_message_at || !conversation.last_message_sender_id) return total;
      if (conversation.last_message_sender_id === auth.user.id) return total;
      if (ignoredProfileIds.has(conversation.last_message_sender_id)) return total;
      const lastReadAt = readByConversation.get(conversation.id);
      if (!lastReadAt || new Date(conversation.last_message_at) > new Date(lastReadAt)) return total + 1;
      return total;
    }, 0);

    return jsonResponse({ unreadCount });
  } catch (error) {
    console.error("messages unread-count failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar contador de mensagens." }, { status: 500 });
  }
}
