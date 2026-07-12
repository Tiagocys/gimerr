import { getSupabaseRestUrl, jsonResponse } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanUuid(value) {
  const text = cleanText(value, 120);
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
}

function toPublicPost(row) {
  return {
    id: row.id,
    gameId: row.game_igdb_id,
    type: row.post_type,
    body: row.body,
    mediaUrl: row.media_url,
    mediaType: row.media_type,
    mediaItems: Array.isArray(row.media_items) ? row.media_items : [],
    videoStatus: row.video_status,
    originalMediaUrl: row.original_media_url,
    readyMediaUrl: row.ready_media_url,
    videoThumbnailUrl: row.video_thumbnail_url,
    commentCount: Number(row.comment_count || 0),
    videoViewCount: Number(row.video_view_count || 0),
    processingError: row.processing_error,
    createdAt: row.created_at,
    author: {
      id: row.profile_id,
      displayName: row.display_name || row.username || "Usuário Gimerr",
      username: row.username,
      avatarUrl: row.avatar_url,
    },
    game: {
      id: row.game_igdb_id,
      name: row.game_name,
      slug: row.game_slug,
      coverUrl: row.game_cover_url,
    },
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const requestUrl = new URL(request.url);
    const postId = cleanUuid(requestUrl.searchParams.get("id") || requestUrl.searchParams.get("post"));
    if (!postId) {
      return jsonResponse({ error: "Post inválido." }, { status: 400 });
    }

    const url = new URL(`${getSupabaseRestUrl(env)}/public_feed_posts`);
    url.searchParams.set("select", "*");
    url.searchParams.set("id", `eq.${postId}`);
    url.searchParams.set("limit", "1");

    const response = await fetch(url.toString(), {
      headers: getServiceHeaders(env),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) throw new Error(rows.message || "Não foi possível carregar o post.");
    if (!rows[0]) {
      return jsonResponse({ error: "Post não encontrado." }, { status: 404 });
    }

    return jsonResponse({ post: toPublicPost(rows[0]) });
  } catch (error) {
    console.error("post detail failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar post." }, { status: 500 });
  }
}
