import { deleteR2Object, hasR2Bucket, putR2Object } from "./auth.js";
import { mutateRows } from "./messages.js";

const ACCEPTED_IMAGE_TYPES = /^image\/(jpeg|png|webp)$/;
const MAX_REPORT_ATTACHMENTS = 5;
const MAX_REPORT_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function getFileExtension(file) {
  if (MIME_EXTENSIONS[file.type]) return MIME_EXTENSIONS[file.type];
  const extension = file.name?.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "bin";
}

export function normalizeReportFiles(files) {
  const attachments = [...(files || [])].filter((file) => file instanceof File && file.size > 0);
  if (attachments.length > MAX_REPORT_ATTACHMENTS) {
    const error = new Error("Envie no máximo 5 imagens na denúncia.");
    error.status = 400;
    throw error;
  }
  attachments.forEach((file) => {
    if (!ACCEPTED_IMAGE_TYPES.test(file.type)) {
      const error = new Error("Envie imagens JPG, PNG ou WebP.");
      error.status = 400;
      throw error;
    }
    if (file.size > MAX_REPORT_ATTACHMENT_BYTES) {
      const error = new Error("Cada imagem deve ter no máximo 3 MB após a compressão.");
      error.status = 413;
      throw error;
    }
  });
  return attachments;
}

export async function appendReportAttachments(env, { conversationId, senderId, files }) {
  const attachments = normalizeReportFiles(files);
  if (!attachments.length) return [];
  if (!hasR2Bucket(env)) {
    const error = new Error("R2 binding indisponível para enviar imagens.");
    error.status = 500;
    throw error;
  }

  const uploaded = [];
  try {
    for (const file of attachments) {
      const extension = getFileExtension(file);
      const key = `report-pics/${senderId}/${crypto.randomUUID()}.${extension}`;
      await putR2Object(env, key, await file.arrayBuffer(), {
        httpMetadata: {
          contentType: file.type,
          cacheControl: "public, max-age=31536000, immutable",
        },
        customMetadata: {
          ownerId: senderId,
          target: "report",
          conversationId,
        },
      });
      uploaded.push({
        media_url: `/api/media/${key}`,
        media_key: key,
        media_type: file.type,
      });
    }

    const messages = await mutateRows(env, "conversation_messages", {
      body: uploaded.map((item) => ({
        conversation_id: conversationId,
        sender_id: senderId,
        body: null,
        media_url: item.media_url,
        media_key: item.media_key,
        media_type: item.media_type,
      })),
    });

    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      await mutateRows(env, "message_conversations", {
        method: "PATCH",
        params: { id: `eq.${conversationId}` },
        body: {
          last_message_at: lastMessage.created_at,
          last_message_sender_id: senderId,
        },
        prefer: "return=minimal",
      });
    }

    return messages;
  } catch (error) {
    await Promise.allSettled(uploaded.map((item) => deleteR2Object(env, item.media_key)));
    throw error;
  }
}
