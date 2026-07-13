import { jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { fetchRows, inFilter, toProfile } from "../../_shared/messages.js";
import { fetchIgnoredProfileIds } from "../../_shared/ignored-users.js";

function toPublicConversation({ conversation, participants, profiles, latestMessage, ownParticipant, listing, ignoredProfileIds }) {
  const otherParticipants = participants
    .filter((participant) => participant.profile_id !== ownParticipant.profile_id)
    .map((participant) => toProfile(profiles.get(participant.profile_id)))
    .filter(Boolean);
  const other = otherParticipants[0] || null;
  const isSpam = otherParticipants.some((profile) => ignoredProfileIds.has(profile.id));
  const title = conversation.conversation_type === "listing"
    ? (listing?.game_name ? `Anúncio em ${listing.game_name}` : "Conversa do Marketplace")
    : (other?.displayName || "Conversa");
  const subtitle = latestMessage?.body || (latestMessage?.media_url ? "Imagem enviada" : (other?.username ? `@${other.username}` : "Sem mensagens ainda."));
  const unread = latestMessage
    && latestMessage.sender_id !== ownParticipant.profile_id
    && (!ownParticipant.last_read_at || new Date(latestMessage.created_at) > new Date(ownParticipant.last_read_at));

  return {
    id: conversation.id,
    type: conversation.conversation_type,
    listingPostId: conversation.listing_post_id,
    title,
    subtitle,
    unread: Boolean(unread),
    spam: Boolean(isSpam),
    lastMessageAt: conversation.last_message_at || latestMessage?.created_at || conversation.created_at,
    otherParticipants,
    listing: listing ? {
      id: listing.id,
      gameName: listing.game_name,
      body: listing.body,
      mediaUrl: listing.media_url,
    } : null,
    latestMessage: latestMessage ? {
      id: latestMessage.id,
      body: latestMessage.body,
      mediaUrl: latestMessage.media_url || "",
      mediaType: latestMessage.media_type || "",
      senderId: latestMessage.sender_id,
      createdAt: latestMessage.created_at,
    } : null,
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const [ownParticipants, ignoredProfileIds] = await Promise.all([
      fetchRows(env, "message_conversation_participants", {
        select: "conversation_id,profile_id,last_read_at,created_at",
        profile_id: `eq.${auth.user.id}`,
        order: "created_at.desc",
        limit: "80",
      }),
      fetchIgnoredProfileIds(env, auth.user.id),
    ]);
    const conversationIds = ownParticipants.map((row) => row.conversation_id).filter(Boolean);
    if (!conversationIds.length) return jsonResponse({ conversations: [] });

    const [conversations, allParticipants, latestMessages] = await Promise.all([
      fetchRows(env, "message_conversations", {
        select: "id,conversation_type,listing_post_id,created_by,status,last_message_at,last_message_sender_id,created_at,updated_at",
        id: inFilter(conversationIds),
        status: "eq.active",
      }),
      fetchRows(env, "message_conversation_participants", {
        select: "conversation_id,profile_id,last_read_at,created_at",
        conversation_id: inFilter(conversationIds),
      }),
      fetchRows(env, "conversation_messages", {
        select: "id,conversation_id,sender_id,body,media_url,media_type,created_at",
        conversation_id: inFilter(conversationIds),
        status: "eq.active",
        order: "created_at.desc",
        limit: "240",
      }),
    ]);

    const profileIds = allParticipants.map((row) => row.profile_id).filter(Boolean);
    const profiles = profileIds.length
      ? await fetchRows(env, "profiles", {
        select: "id,display_name,username,avatar_url",
        id: inFilter(profileIds),
      })
      : [];
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

    const listingIds = conversations.map((row) => row.listing_post_id).filter(Boolean);
    const listings = listingIds.length
      ? await fetchRows(env, "public_feed_posts", {
        select: "id,body,media_url,game_name",
        id: inFilter(listingIds),
      })
      : [];
    const listingsById = new Map(listings.map((listing) => [listing.id, listing]));

    const participantsByConversation = new Map();
    allParticipants.forEach((participant) => {
      const current = participantsByConversation.get(participant.conversation_id) || [];
      current.push(participant);
      participantsByConversation.set(participant.conversation_id, current);
    });
    const ownByConversation = new Map(ownParticipants.map((participant) => [participant.conversation_id, participant]));
    const latestByConversation = new Map();
    latestMessages.forEach((message) => {
      if (!latestByConversation.has(message.conversation_id)) {
        latestByConversation.set(message.conversation_id, message);
      }
    });

    const publicConversations = conversations
      .map((conversation) => toPublicConversation({
        conversation,
        participants: participantsByConversation.get(conversation.id) || [],
        profiles: profilesById,
        latestMessage: latestByConversation.get(conversation.id) || null,
        ownParticipant: ownByConversation.get(conversation.id) || { profile_id: auth.user.id },
        listing: listingsById.get(conversation.listing_post_id) || null,
        ignoredProfileIds,
      }))
      .sort((left, right) => new Date(right.lastMessageAt) - new Date(left.lastMessageAt));

    return jsonResponse({ conversations: publicConversations });
  } catch (error) {
    console.error("messages conversations failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar conversas." }, { status: 500 });
  }
}
