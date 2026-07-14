import { jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { cleanMessageText, cleanUuid, mutateRows, requireConversationParticipant, touchConversationRead } from "../../_shared/messages.js";

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanConversationMedia(payload, ownerId) {
  const mediaUrl = cleanText(payload.mediaUrl, 500);
  const mediaKey = cleanText(payload.mediaKey, 500);
  const mediaType = cleanText(payload.mediaType, 80);
  if (!mediaUrl && !mediaKey && !mediaType) return { mediaUrl: null, mediaKey: null, mediaType: null };
  const expectedPrefix = `conversation-pics/${ownerId}/`;
  if (!mediaKey.startsWith(expectedPrefix)) {
    throw new Error("Imagem inválida.");
  }
  if (mediaUrl !== `/api/media/${mediaKey}`) {
    throw new Error("Imagem inválida.");
  }
  if (!/^image\/(jpeg|png|webp)$/.test(mediaType)) {
    throw new Error("Tipo de imagem inválido.");
  }
  return { mediaUrl, mediaKey, mediaType };
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const conversationId = cleanUuid(payload.conversationId);
    const body = cleanMessageText(payload.body, 2000);
    const media = cleanConversationMedia(payload, auth.user.id);
    if (!conversationId) return jsonResponse({ error: "Conversa inválida." }, { status: 400 });
    if (!body && !media.mediaUrl) return jsonResponse({ error: "Escreva uma mensagem ou anexe uma imagem." }, { status: 400 });

    const ownParticipant = await requireConversationParticipant(env, conversationId, auth.user.id);
    if (!ownParticipant) return jsonResponse({ error: "Conversa não encontrada." }, { status: 404 });

    const [message] = await mutateRows(env, "conversation_messages", {
      body: {
        conversation_id: conversationId,
        sender_id: auth.user.id,
        body: body || null,
        media_url: media.mediaUrl,
        media_key: media.mediaKey,
        media_type: media.mediaType,
      },
    });
    const now = new Date().toISOString();
    await Promise.allSettled([
      mutateRows(env, "message_conversations", {
        method: "PATCH",
        params: { id: `eq.${conversationId}` },
        body: {
          last_message_at: message?.created_at || now,
          last_message_sender_id: auth.user.id,
        },
        prefer: "return=minimal",
      }),
      touchConversationRead(env, conversationId, auth.user.id),
    ]);

    return jsonResponse({
      message: {
        id: message.id,
        conversationId,
        body: message.body || "",
        mediaUrl: message.media_url || "",
        mediaType: message.media_type || "",
        createdAt: message.created_at,
        isOwn: true,
        readByOthers: false,
        author: null,
      },
    });
  } catch (error) {
    console.error("messages send failed", error);
    return jsonResponse({ error: error?.message || "Falha ao enviar mensagem." }, { status: 500 });
  }
}
