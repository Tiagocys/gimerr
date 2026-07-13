import { jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { cleanUuid, fetchRows, inFilter, mutateRows } from "../../_shared/messages.js";

async function fetchListing(env, listingPostId) {
  if (!listingPostId) return null;
  const rows = await fetchRows(env, "feed_posts", {
    select: "id,profile_id,post_type,status,body",
    id: `eq.${listingPostId}`,
    post_type: "eq.listing",
    status: "eq.active",
    limit: "1",
  });
  return rows[0] || null;
}

async function findExistingConversation(env, { viewerId, recipientId, listingPostId }) {
  const [viewerParticipants, recipientParticipants] = await Promise.all([
    fetchRows(env, "message_conversation_participants", {
      select: "conversation_id",
      profile_id: `eq.${viewerId}`,
      limit: "120",
    }),
    fetchRows(env, "message_conversation_participants", {
      select: "conversation_id",
      profile_id: `eq.${recipientId}`,
      limit: "120",
    }),
  ]);
  const recipientConversationIds = new Set(recipientParticipants.map((row) => row.conversation_id));
  const commonIds = viewerParticipants
    .map((row) => row.conversation_id)
    .filter((id) => recipientConversationIds.has(id));
  if (!commonIds.length) return null;

  const params = {
    select: "id,conversation_type,listing_post_id,created_at",
    id: inFilter(commonIds),
    status: "eq.active",
    limit: "1",
  };
  if (listingPostId) {
    params.conversation_type = "eq.listing";
    params.listing_post_id = `eq.${listingPostId}`;
  } else {
    params.conversation_type = "eq.direct";
    params.listing_post_id = "is.null";
  }

  const rows = await fetchRows(env, "message_conversations", params);
  return rows[0] || null;
}

export async function onRequestPost({ request, env }) {
  let stage = "start";
  try {
    stage = "auth";
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    stage = "payload";
    const payload = await request.json().catch(() => ({}));
    const listingPostId = cleanUuid(payload.listingPostId);
    let recipientId = cleanUuid(payload.recipientId);
    stage = "listing";
    const listing = await fetchListing(env, listingPostId);
    if (listingPostId && !listing) {
      return jsonResponse({ error: "Anúncio não encontrado ou indisponível." }, { status: 404 });
    }
    if (listing) recipientId = listing.profile_id;
    if (!recipientId) return jsonResponse({ error: "Destinatário inválido." }, { status: 400 });
    if (recipientId === auth.user.id) return jsonResponse({ error: "Você não pode iniciar conversa consigo mesmo." }, { status: 400 });

    stage = "existing_conversation";
    const existing = await findExistingConversation(env, {
      viewerId: auth.user.id,
      recipientId,
      listingPostId: listing?.id || "",
    });
    if (existing) return jsonResponse({ conversationId: existing.id, created: false });

    stage = "create_conversation";
    const [conversation] = await mutateRows(env, "message_conversations", {
      body: {
        conversation_type: listing ? "listing" : "direct",
        listing_post_id: listing?.id || null,
        created_by: auth.user.id,
      },
    });
    if (!conversation?.id) {
      return jsonResponse({ error: "Não foi possível criar a conversa.", stage }, { status: 500 });
    }
    stage = "create_participants";
    await mutateRows(env, "message_conversation_participants", {
      body: [
        { conversation_id: conversation.id, profile_id: auth.user.id, last_read_at: new Date().toISOString() },
        { conversation_id: conversation.id, profile_id: recipientId, last_read_at: null },
      ],
    });

    return jsonResponse({ conversationId: conversation.id, created: true });
  } catch (error) {
    console.error("messages start failed", { stage, error });
    return jsonResponse({
      error: error?.message || "Falha ao iniciar conversa.",
      stage,
      path: error?.path || "",
      detail: error?.details || "",
      status: error?.status || 500,
    }, { status: 500 });
  }
}
