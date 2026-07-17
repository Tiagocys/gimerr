import { hasR2Bucket, jsonResponse, putR2Object, requireAuthUser } from "../_shared/auth.js";

const TARGETS = {
  post: {
    folder: "posts",
    accept: /^image\/(jpeg|png|webp|gif)$/,
    maxBytes: 5 * 1024 * 1024,
  },
  listing: {
    folder: "market",
    accept: /^image\/(jpeg|png|webp|gif)$/,
    maxBytes: 10 * 1024 * 1024,
  },
  video: {
    folder: "videos/originals",
    accept: /^video\/(mp4|webm|quicktime)$/,
    maxBytes: 500 * 1024 * 1024,
  },
  "video-thumbnail": {
    folder: "videos/thumbnails",
    accept: /^image\/(jpeg|png|webp)$/,
    maxBytes: 2 * 1024 * 1024,
  },
};

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function getFileExtension(file) {
  if (MIME_EXTENSIONS[file.type]) return MIME_EXTENSIONS[file.type];
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "bin";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!hasR2Bucket(env)) {
      return jsonResponse({ error: "R2 binding indisponível para enviar mídia." }, { status: 500 });
    }

    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const formData = await request.formData();
    const target = String(formData.get("target") || "post");
    const file = formData.get("file");
    const config = TARGETS[target];

    if (!config) {
      return jsonResponse({ error: "Tipo de publicação inválido." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return jsonResponse({ error: "Arquivo não enviado." }, { status: 400 });
    }

    if (!config.accept.test(file.type)) {
      return jsonResponse({ error: target === "video" ? "Envie um vídeo MP4, WebM ou MOV." : "Envie uma imagem JPG, PNG, WebP ou GIF." }, { status: 400 });
    }

    if (file.size > config.maxBytes) {
      return jsonResponse({ error: "Arquivo acima do limite permitido." }, { status: 413 });
    }

    const extension = getFileExtension(file);
    const key = `${config.folder}/${auth.user.id}/${crypto.randomUUID()}.${extension}`;
    const body = await file.arrayBuffer();

    await putR2Object(env, key, body, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        ownerId: auth.user.id,
        target,
      },
    });

    return jsonResponse({
      key,
      url: `/api/media/${key}`,
      mediaType: file.type,
    });
  } catch (error) {
    console.error("post-media-upload failed", error);
    return jsonResponse({ error: error?.message || "Falha ao enviar mídia." }, { status: 500 });
  }
}
