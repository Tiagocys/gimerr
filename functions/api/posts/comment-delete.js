import { deleteR2Object, getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function fetchComment(env, commentId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/post_comments`);
  url.searchParams.set("select", "id,post_id,profile_id,status,media_key");
  url.searchParams.set("id", `eq.${commentId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar comentário.");
  return rows[0] || null;
}

async function markCommentDeleted(env, commentId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/post_comments`);
  url.searchParams.set("id", `eq.${commentId}`);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify({ status: "deleted" }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível apagar comentário.");
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const commentId = cleanText(payload.commentId || payload.comment, 80);
    if (!commentId) {
      return jsonResponse({ error: "Comentário ausente." }, { status: 400 });
    }

    const comment = await fetchComment(env, commentId);
    if (!comment || comment.status !== "active") {
      return jsonResponse({ error: "Comentário não encontrado." }, { status: 404 });
    }

    if (comment.profile_id !== auth.user.id) {
      return jsonResponse({ error: "Você só pode apagar seus próprios comentários." }, { status: 403 });
    }

    await markCommentDeleted(env, comment.id);
    if (comment.media_key && String(comment.media_key).startsWith("comment-pics/")) {
      await deleteR2Object(env, comment.media_key).catch((error) => {
        console.warn("Não foi possível remover imagem do comentário.", error);
      });
    }

    return jsonResponse({
      ok: true,
      postId: comment.post_id,
      deletedCommentIds: [comment.id],
      deletedCount: 1,
    });
  } catch (error) {
    console.error("post comment delete failed", error);
    return jsonResponse({ error: error?.message || "Falha ao apagar comentário." }, { status: 500 });
  }
}
