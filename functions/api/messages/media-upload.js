import { hasR2Bucket, jsonResponse, putR2Object, requireAuthUser } from "../../_shared/auth.js";
import { cleanUuid, requireConversationParticipant } from "../../_shared/messages.js";

const ACCEPTED_IMAGE_TYPES = /^image\/(jpeg|png|webp)$/;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function getFileExtension(file) {
  if (MIME_EXTENSIONS[file.type]) return MIME_EXTENSIONS[file.type];
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "bin";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!hasR2Bucket(env)) {
      return jsonResponse({ error: "R2 binding indisponível para enviar imagem." }, { status: 500 });
    }

    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const formData = await request.formData();
    const conversationId = cleanUuid(formData.get("conversationId"));
    const file = formData.get("file");
    if (!conversationId) return jsonResponse({ error: "Conversa inválida." }, { status: 400 });

    const ownParticipant = await requireConversationParticipant(env, conversationId, auth.user.id);
    if (!ownParticipant) return jsonResponse({ error: "Conversa não encontrada." }, { status: 404 });

    if (!(file instanceof File)) {
      return jsonResponse({ error: "Imagem não enviada." }, { status: 400 });
    }
    if (!ACCEPTED_IMAGE_TYPES.test(file.type)) {
      return jsonResponse({ error: "Envie uma imagem JPG, PNG ou WebP." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "A imagem deve ter no máximo 3 MB após a compressão." }, { status: 413 });
    }

    const extension = getFileExtension(file);
    const key = `conversation-pics/${auth.user.id}/${crypto.randomUUID()}.${extension}`;
    const body = await file.arrayBuffer();

    await putR2Object(env, key, body, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        ownerId: auth.user.id,
        target: "conversation",
        conversationId,
      },
    });

    return jsonResponse({
      key,
      url: `/api/media/${key}`,
      mediaType: file.type,
    });
  } catch (error) {
    console.error("messages media-upload failed", error);
    return jsonResponse({ error: error?.message || "Falha ao enviar imagem." }, { status: 500 });
  }
}
