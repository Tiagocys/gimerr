import { deleteR2Object, hasR2Bucket, jsonResponse, requireAuthUser } from "../_shared/auth.js";

const DELETE_TARGETS = {
  avatar: "profile-pics",
};

function getMediaKey(mediaUrl, folder, userId) {
  if (!mediaUrl) return "";

  const rawValue = String(mediaUrl);
  let pathname = rawValue;

  try {
    pathname = new URL(rawValue, "https://gimerr.local").pathname;
  } catch {
    pathname = rawValue;
  }

  const mediaPrefix = "/api/media/";
  const mediaIndex = pathname.indexOf(mediaPrefix);
  const key = decodeURIComponent(mediaIndex >= 0
    ? pathname.slice(mediaIndex + mediaPrefix.length)
    : pathname.replace(/^\/+/, ""));
  const allowedPrefix = `${folder}/${userId}/`;

  return key.startsWith(allowedPrefix) ? key : "";
}

export async function onRequestPost({ request, env }) {
  try {
    if (!hasR2Bucket(env)) {
      return jsonResponse({ error: "R2 binding indisponível neste ambiente." }, { status: 500 });
    }

    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const folder = DELETE_TARGETS[body.target];
    if (!folder) {
      return jsonResponse({ error: "Tipo de imagem inválido." }, { status: 400 });
    }

    const key = getMediaKey(body.url, folder, auth.user.id);
    if (!key) {
      return jsonResponse({ ok: true, deleted: false });
    }

    await deleteR2Object(env, key);
    return jsonResponse({ ok: true, deleted: true, key });
  } catch (error) {
    console.warn("profile-image-delete failed", error);
    return jsonResponse({
      error: error?.message || "Falha ao remover imagem antiga.",
    }, { status: 500 });
  }
}
