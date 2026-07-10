import { hasR2Bucket, jsonResponse, putR2Object, requireAuthUser } from "../_shared/auth.js";

const UPLOAD_TARGETS = {
  avatar: {
    folder: "profile-pics",
    maxBytes: 5 * 1024 * 1024,
  },
};

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function getFileExtension(file) {
  if (MIME_EXTENSIONS[file.type]) return MIME_EXTENSIONS[file.type];
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : "bin";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!hasR2Bucket(env)) {
      return jsonResponse({
        error: "R2 binding indisponível neste ambiente. Configure o bucket gimerr nas bindings de R2 do Cloudflare Pages para produção e preview, de preferência com o nome GIMERR_R2_BUCKET.",
        stage: "r2_binding",
      }, { status: 500 });
    }

    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const formData = await request.formData();
    const target = String(formData.get("target") || "");
    const file = formData.get("file");
    const config = UPLOAD_TARGETS[target];

    if (!config) {
      return jsonResponse({ error: "Tipo de upload inválido." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return jsonResponse({ error: "Arquivo não enviado." }, { status: 400 });
    }

    if (!file.type.startsWith("image/") || !MIME_EXTENSIONS[file.type]) {
      return jsonResponse({ error: "Envie uma imagem JPG, PNG, WebP ou GIF." }, { status: 400 });
    }

    if (file.size > config.maxBytes) {
      return jsonResponse({ error: "Imagem acima do limite permitido." }, { status: 413 });
    }

    const extension = getFileExtension(file);
    const key = `${config.folder}/${auth.user.id}/${target}.${extension}`;
    const version = crypto.randomUUID();
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
      url: `/api/media/${key}?v=${version}`,
    });
  } catch (error) {
    console.error("profile-image-upload failed", error);
    return jsonResponse({
      error: error?.message || "Falha ao enviar imagem.",
      stage: "upload_exception",
    }, { status: 500 });
  }
}
