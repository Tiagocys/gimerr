import { hasR2Bucket, jsonResponse, putR2Object, requireAuthUser } from "../_shared/auth.js";

const MAX_COVER_BYTES = 5 * 1024 * 1024;

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
      return jsonResponse({ error: "R2 binding indisponível para enviar a logo." }, { status: 500 });
    }

    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return jsonResponse({ error: "Arquivo não enviado." }, { status: 400 });
    }

    if (!MIME_EXTENSIONS[file.type]) {
      return jsonResponse({ error: "Envie uma imagem JPG, PNG ou WebP." }, { status: 400 });
    }

    if (file.size > MAX_COVER_BYTES) {
      return jsonResponse({ error: "A logo deve ter no máximo 5 MB." }, { status: 413 });
    }

    const extension = getFileExtension(file);
    const key = `game_covers/${auth.user.id}/${crypto.randomUUID()}.${extension}`;
    const body = await file.arrayBuffer();

    await putR2Object(env, key, body, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        ownerId: auth.user.id,
        target: "game_cover",
      },
    });

    return jsonResponse({
      key,
      url: `/api/media/${key}`,
    });
  } catch (error) {
    console.error("game-cover-upload failed", error);
    return jsonResponse({ error: error?.message || "Falha ao enviar a logo." }, { status: 500 });
  }
}
