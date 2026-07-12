import { createR2PresignedPutUrl, hasR2Bucket, jsonResponse, requireAuthUser } from "../_shared/auth.js";
import { requireVerifiedProfile } from "../_shared/verification.js";

const TARGETS = {
  video: {
    folder: "videos/originals",
    accept: /^video\/(mp4|webm|quicktime)$/,
    maxBytes: 500 * 1024 * 1024,
  },
};

const MIME_EXTENSIONS = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getFileExtension(name, type) {
  if (MIME_EXTENSIONS[type]) return MIME_EXTENSIONS[type];
  const extension = String(name || "").split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "bin";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!hasR2Bucket(env)) {
      return jsonResponse({ error: "R2 indisponível para enviar mídia." }, { status: 500 });
    }

    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const verification = await requireVerifiedProfile(env, auth.user.id);
    if (verification.error) return verification.error;

    const payload = await request.json().catch(() => ({}));
    const target = cleanText(payload.target || "video", 40);
    const type = cleanText(payload.mediaType || "", 120);
    const name = cleanText(payload.fileName || "", 240);
    const size = Number(payload.size || 0);
    const config = TARGETS[target];

    if (!config) {
      return jsonResponse({ error: "Tipo de publicação inválido para upload direto." }, { status: 400 });
    }

    if (!config.accept.test(type)) {
      return jsonResponse({ error: "Envie um vídeo MP4, WebM ou MOV." }, { status: 400 });
    }

    if (!Number.isFinite(size) || size <= 0 || size > config.maxBytes) {
      return jsonResponse({ error: "Arquivo acima do limite permitido." }, { status: 413 });
    }

    const extension = getFileExtension(name, type);
    const key = `${config.folder}/${auth.user.id}/${crypto.randomUUID()}.${extension}`;
    const uploadUrl = await createR2PresignedPutUrl(env, key, { expiresSeconds: 900 });

    if (!uploadUrl) {
      return jsonResponse({ error: "Upload direto indisponível neste ambiente." }, { status: 500 });
    }

    return jsonResponse({
      key,
      url: `/api/media/${key}`,
      mediaType: type,
      uploadUrl,
      headers: {
        "content-type": type,
      },
    });
  } catch (error) {
    console.error("post-media-upload-url failed", error);
    return jsonResponse({ error: error?.message || "Falha ao preparar upload." }, { status: 500 });
  }
}
