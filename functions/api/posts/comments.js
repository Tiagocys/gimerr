import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanNumber(value, fallback, { min = 0, max = 100 } = {}) {
  const number = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function extractMentionUsernames(text, authorUsername = "") {
  const mentions = [];
  const seen = new Set();
  const author = String(authorUsername || "").toLowerCase();
  const pattern = /(^|[\s([{"'“‘])@([a-z0-9_.]{3,24})(?=$|[\s),.!?:;}"'”’\]])/gi;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    const username = match[2].replace(/\.+$/, "");
    const key = username.toLowerCase();
    if (!username || key === author || seen.has(key)) continue;
    seen.add(key);
    mentions.push(key);
  }
  return mentions;
}

function toPublicComment(row) {
  const hasParent = Boolean(row.parent_comment_id);
  return {
    id: row.id,
    postId: row.post_id,
    parentCommentId: row.parent_comment_id || null,
    body: row.body,
    mediaUrl: row.media_url || "",
    mediaKey: row.media_key || "",
    mediaType: row.media_type || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.profile_id,
      displayName: row.display_name || row.username || "Usuário Gimerr",
      username: row.username,
      avatarUrl: row.avatar_url,
    },
    parent: hasParent && row.parent_status
      ? {
        id: row.parent_comment_id,
        status: row.parent_status,
        body: row.parent_body || "",
        author: {
          id: row.parent_profile_id || null,
          displayName: row.parent_display_name || row.parent_username || "",
          username: row.parent_username || "",
          avatarUrl: row.parent_avatar_url || "",
        },
      }
      : null,
  };
}

function normalizeUsername(value, fallback = "player") {
  const normalized = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "")
    .slice(0, 24);
  return normalized.length >= 3 ? normalized : fallback;
}

function getAuthDisplayName(user) {
  return cleanText(
    user?.user_metadata?.full_name
    || user?.user_metadata?.name
    || user?.user_metadata?.preferred_username
    || String(user?.email || "").split("@")[0]
    || "Usuário Gimerr",
    80,
  ) || "Usuário Gimerr";
}

function getAuthUsername(user) {
  return normalizeUsername(
    user?.user_metadata?.preferred_username
    || user?.user_metadata?.user_name
    || user?.user_metadata?.name
    || String(user?.email || "").split("@")[0],
    `player_${String(user?.id || "").replace(/-/g, "").slice(0, 8)}`,
  );
}

function isMissingCommentsSchema(error) {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  return (
    code === "PGRST205"
    || code === "42P01"
    || /schema cache|could not find the table|relation .* does not exist/i.test(message)
  );
}

function getBearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.replace(/^bearer\s+/i, "")
    : "";
}

function isMissingCommentRpc(error) {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  return (
    code === "PGRST202"
    || code === "PGRST203"
    || /schema cache|could not find.*create_post_comment|function .*create_post_comment/i.test(message)
  );
}

async function fetchPost(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/public_feed_posts`);
  url.searchParams.set("select", "id,profile_id,body");
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar o post.");
  return rows[0] || null;
}

async function createCommentViaRpc(env, token, { postId, body, parentCommentId = null, media = null }) {
  if (!token) {
    const error = new Error("Sessão ausente.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(`${getSupabaseRestUrl(env)}/rpc/create_post_comment`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      comment_post_id: postId,
      comment_body: body,
      comment_parent_comment_id: parentCommentId || null,
      comment_media_url: media?.url || null,
      comment_media_key: media?.key || null,
      comment_media_type: media?.mediaType || null,
    }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    const error = new Error(rows.message || rows.error || "Não foi possível comentar.");
    error.code = rows.code || "";
    error.details = rows.details || "";
    error.status = response.status;
    throw error;
  }

  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    const error = new Error("Não foi possível comentar.");
    error.status = 500;
    throw error;
  }

  const author = {
    id: row.profile_id,
    display_name: row.display_name,
    username: row.username,
    avatar_url: row.avatar_url,
  };

  return {
    comment: row,
    author,
    post: {
      id: row.post_id,
      profile_id: row.post_author_id,
    },
    parentCommentAuthorId: row.parent_comment_author_id || null,
  };
}

async function fetchProfile(env, profileId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,display_name,username,avatar_url");
  url.searchParams.set("id", `eq.${profileId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar perfil.");
  return rows[0] || null;
}

async function createProfileFromAuth(env, user) {
  const baseUsername = getAuthUsername(user);
  const displayName = getAuthDisplayName(user);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const suffix = attempt === 0 ? "" : `_${String(user.id).replace(/-/g, "").slice(attempt, attempt + 4)}`;
    const usernameRoot = baseUsername.slice(0, Math.max(3, 24 - suffix.length));
    const username = normalizeUsername(`${usernameRoot}${suffix}`, `player_${String(user.id).replace(/-/g, "").slice(0, 8)}`);
    const response = await fetch(`${getSupabaseRestUrl(env)}/profiles`, {
      method: "POST",
      headers: getServiceHeaders(env, { prefer: "return=representation" }),
      body: JSON.stringify({
        id: user.id,
        display_name: displayName,
        username,
        avatar_url: null,
      }),
    });
    const rows = await response.json().catch(() => []);
    if (response.ok) return rows[0] || null;
    if (response.status === 409) {
      const existing = await fetchProfile(env, user.id);
      if (existing) return existing;
      continue;
    }
    throw new Error(rows.message || "Não foi possível preparar seu perfil para comentar.");
  }

  throw new Error("Não foi possível preparar seu perfil para comentar.");
}

async function ensureCommentProfile(env, user, knownProfile = null) {
  if (knownProfile?.id && knownProfile.display_name && knownProfile.username) {
    return knownProfile;
  }
  const profile = await fetchProfile(env, user.id);
  if (profile) return profile;
  return createProfileFromAuth(env, user);
}

async function findMentionedProfiles(env, usernames) {
  if (!usernames.length) return [];
  const url = new URL(`${getSupabaseRestUrl(env)}/public_profiles`);
  url.searchParams.set("select", "id,display_name,username");
  url.searchParams.set("username", `in.(${usernames.join(",")})`);

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    console.warn("Não foi possível resolver usuários marcados no comentário.", rows.message || rows);
    return [];
  }
  return rows;
}

function normalizeCommentMedia(value) {
  const media = value && typeof value === "object" ? value : {};
  const url = cleanText(media.url || media.mediaUrl, 500);
  const key = cleanText(media.key || media.mediaKey, 500);
  const mediaType = cleanText(media.mediaType || media.type, 120);
  if (!url && !key && !mediaType) return null;
  if (!url || !key || !mediaType) {
    const error = new Error("Imagem do comentário inválida.");
    error.status = 400;
    throw error;
  }
  if (!/^\/api\/media\/comment-pics\/[0-9a-f-]+\//i.test(url) || !/^comment-pics\/[0-9a-f-]+\//i.test(key)) {
    const error = new Error("Imagem do comentário inválida.");
    error.status = 400;
    throw error;
  }
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(mediaType)) {
    const error = new Error("Envie uma imagem JPG, PNG, WebP ou GIF.");
    error.status = 400;
    throw error;
  }
  return { url, key, mediaType };
}

async function insertComment(env, payload) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/post_comments`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    const error = new Error(rows.message || "Não foi possível comentar.");
    error.code = rows.code || "";
    error.details = rows.details || "";
    error.status = response.status;
    throw error;
  }
  return rows[0] || null;
}

async function notifyCommentTarget(env, { post, comment, author, parentCommentAuthorId = null }) {
  const recipientId = parentCommentAuthorId || post?.profile_id;
  if (!recipientId || recipientId === author?.id) return;

  const authorName = author?.display_name || author?.username || "Um usuário";
  if (!parentCommentAuthorId) {
    await upsertPostCommentNotification(env, {
      recipientId,
      post,
      comment,
      author,
      authorName,
    });
    return;
  }

  const response = await fetch(`${getSupabaseRestUrl(env)}/notifications`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify({
      recipient_id: recipientId,
      sender_name: authorName,
      sender_avatar_url: author?.avatar_url || null,
      type: "post_comment",
      title: parentCommentAuthorId
        ? `${authorName} respondeu seu comentário.`
        : `${authorName} comentou no seu post.`,
      body: comment.body,
      action_url: `/post?id=${post.id}`,
      data: {
        post_id: post.id,
        comment_id: comment.id,
        parent_comment_id: comment.parent_comment_id || null,
        author_id: author?.id || null,
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    console.warn("Não foi possível criar notificação de comentário.", payload.message || payload);
  }
}

async function upsertPostCommentNotification(env, { recipientId, post, comment, author, authorName }) {
  const existingUrl = new URL(`${getSupabaseRestUrl(env)}/notifications`);
  existingUrl.searchParams.set("select", "id,data");
  existingUrl.searchParams.set("recipient_id", `eq.${recipientId}`);
  existingUrl.searchParams.set("type", "eq.post_comment");
  existingUrl.searchParams.set("read_at", "is.null");
  existingUrl.searchParams.set("data->>post_id", `eq.${post.id}`);
  existingUrl.searchParams.set("order", "created_at.desc");
  existingUrl.searchParams.set("limit", "1");

  const existingResponse = await fetch(existingUrl.toString(), {
    headers: getServiceHeaders(env),
  });
  const existingRows = await existingResponse.json().catch(() => []);
  if (!existingResponse.ok) {
    console.warn("Não foi possível buscar notificação de comentário existente.", existingRows.message || existingRows);
  }

  const existing = existingResponse.ok ? existingRows[0] : null;
  if (existing?.id) {
    const previousCount = Number(existing.data?.comment_count || 1);
    const nextCount = previousCount + 1;
    const patchUrl = new URL(`${getSupabaseRestUrl(env)}/notifications`);
    patchUrl.searchParams.set("id", `eq.${existing.id}`);

    const patchResponse = await fetch(patchUrl.toString(), {
      method: "PATCH",
      headers: getServiceHeaders(env, { prefer: "return=minimal" }),
      body: JSON.stringify({
        sender_name: authorName,
        sender_avatar_url: author?.avatar_url || null,
        title: `${nextCount} comentários no seu post.`,
        body: comment.body,
        action_url: `/post?id=${post.id}`,
        data: {
          ...(existing.data || {}),
          post_id: post.id,
          comment_id: comment.id,
          author_id: author?.id || null,
          comment_count: nextCount,
          last_author_name: authorName,
        },
        created_at: new Date().toISOString(),
      }),
    });
    if (!patchResponse.ok) {
      const payload = await patchResponse.json().catch(() => ({}));
      console.warn("Não foi possível atualizar notificação de comentário.", payload.message || payload);
    }
    return;
  }

  const response = await fetch(`${getSupabaseRestUrl(env)}/notifications`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify({
      recipient_id: recipientId,
      sender_name: authorName,
      sender_avatar_url: author?.avatar_url || null,
      type: "post_comment",
      title: `${authorName} comentou no seu post.`,
      body: comment.body,
      action_url: `/post?id=${post.id}`,
      data: {
        post_id: post.id,
        comment_id: comment.id,
        author_id: author?.id || null,
        comment_count: 1,
        last_author_name: authorName,
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    console.warn("Não foi possível criar notificação agregada de comentário.", payload.message || payload);
  }
}

async function notifyMentionedUsers(env, { post, comment, author, excludeIds = [] }) {
  const usernames = extractMentionUsernames(comment?.body, author?.username);
  if (!usernames.length) return;

  const mentionedProfiles = await findMentionedProfiles(env, usernames);
  const excluded = new Set(excludeIds.filter(Boolean));
  const recipients = mentionedProfiles.filter((profile) => (
    profile.id
    && profile.id !== author?.id
    && profile.id !== post?.profile_id
    && !excluded.has(profile.id)
  ));
  if (!recipients.length) return;

  const authorName = author?.display_name || author?.username || "Um usuário";
  const notifications = recipients.map((profile) => ({
    recipient_id: profile.id,
    sender_name: authorName,
    sender_avatar_url: author?.avatar_url || null,
    type: "comment_mention",
    title: `${authorName} mencionou você em um comentário.`,
    body: comment.body,
    action_url: `/post?id=${post.id}`,
    data: {
      post_id: post.id,
      comment_id: comment.id,
      parent_comment_id: comment.parent_comment_id || null,
      author_id: author?.id || null,
      author_username: author?.username || null,
      mentioned_username: profile.username,
    },
  }));

  const response = await fetch(`${getSupabaseRestUrl(env)}/notifications`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify(notifications),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    console.warn("Não foi possível criar notificações de marcação em comentário.", payload.message || payload);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const requestUrl = new URL(request.url);
    const postId = cleanText(requestUrl.searchParams.get("postId") || requestUrl.searchParams.get("post"), 80);
    const hasLimitParam = requestUrl.searchParams.has("limit");
    const limit = cleanNumber(requestUrl.searchParams.get("limit"), 100, { min: 1, max: 50 });
    const offset = cleanNumber(requestUrl.searchParams.get("offset"), 0, { min: 0, max: 5000 });
    const fetchLimit = hasLimitParam ? limit + 1 : limit;
    if (!postId) {
      return jsonResponse({ error: "Post inválido." }, { status: 400 });
    }

    const url = new URL(`${getSupabaseRestUrl(env)}/public_post_comments`);
    url.searchParams.set("select", "*");
    url.searchParams.set("post_id", `eq.${postId}`);
    url.searchParams.set("order", "created_at.asc");
    url.searchParams.set("limit", String(fetchLimit));
    if (offset > 0) url.searchParams.set("offset", String(offset));

    const response = await fetch(url.toString(), {
      headers: getServiceHeaders(env),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok) {
      const error = new Error(rows.message || "Não foi possível carregar comentários.");
      if (isMissingCommentsSchema(error)) {
        return jsonResponse({ comments: [], schemaMissing: true });
      }
      throw error;
    }

    const hasMore = hasLimitParam && rows.length > limit;
    return jsonResponse({
      comments: rows.slice(0, limit).map(toPublicComment),
      hasMore,
      nextOffset: offset + Math.min(rows.length, limit),
    });
  } catch (error) {
    console.error("post comments list failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar comentários." }, { status: 500 });
  }
}

function scheduleCommentNotifications(waitUntil, promise) {
  const guardedPromise = promise.catch((error) => {
    console.warn("Falha ao notificar comentário.", error);
  });

  if (typeof waitUntil === "function") {
    waitUntil(guardedPromise);
    return;
  }

  guardedPromise.catch(() => {});
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const payload = await request.json().catch(() => ({}));
    const postId = cleanText(payload.postId || payload.post, 80);
    const parentCommentId = cleanText(payload.parentCommentId || payload.parentComment || "", 80) || null;
    const body = cleanText(payload.body, 500);
    const media = normalizeCommentMedia(payload.media || null);

    if (!postId) {
      return jsonResponse({ error: "Post inválido." }, { status: 400 });
    }
    if (!body && !media) {
      return jsonResponse({ error: "Escreva um comentário ou selecione uma imagem." }, { status: 400 });
    }

    const token = getBearerToken(request);
    try {
      const { comment, post, author, parentCommentAuthorId } = await createCommentViaRpc(env, token, { postId, body, parentCommentId, media });
      scheduleCommentNotifications(waitUntil, Promise.all([
        notifyCommentTarget(env, { post, comment, author, parentCommentAuthorId }),
        notifyMentionedUsers(env, { post, comment, author, excludeIds: [parentCommentAuthorId] }),
      ]));

      return jsonResponse({
        comment: toPublicComment({
          ...comment,
          display_name: author?.display_name,
          username: author?.username,
          avatar_url: author?.avatar_url,
        }),
      });
    } catch (error) {
      if (!isMissingCommentRpc(error)) {
        return jsonResponse({
          error: error?.message || "Não foi possível comentar.",
          code: error?.code || undefined,
        }, { status: error?.status || 500 });
      }
    }

    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const [post, author] = await Promise.all([
      fetchPost(env, postId),
      ensureCommentProfile(env, auth.user, auth.profileAccess),
    ]);
    if (!post) {
      return jsonResponse({ error: "Post não encontrado." }, { status: 404 });
    }

    let comment;
    try {
      comment = await insertComment(env, {
        post_id: postId,
        profile_id: auth.user.id,
        parent_comment_id: parentCommentId,
        body,
        media_url: media?.url || null,
        media_key: media?.key || null,
        media_type: media?.mediaType || null,
      });
    } catch (error) {
      if (isMissingCommentsSchema(error)) {
        return jsonResponse({
          error: "Os comentários ainda não foram ativados no banco de dados.",
          code: "comments_schema_missing",
        }, { status: 503 });
      }
      if (error.code === "23503") {
        return jsonResponse({
          error: "Não foi possível validar seu perfil ou o post para comentar. Atualize a página e tente novamente.",
          code: "comment_reference_missing",
        }, { status: 409 });
      }
      throw error;
    }

    scheduleCommentNotifications(waitUntil, Promise.all([
      notifyCommentTarget(env, { post, comment, author }),
      notifyMentionedUsers(env, { post, comment, author }),
    ]));

    return jsonResponse({
      comment: toPublicComment({
        ...comment,
        display_name: author?.display_name,
        username: author?.username,
        avatar_url: author?.avatar_url,
      }),
    });
  } catch (error) {
    console.error("post comment create failed", error);
    return jsonResponse({ error: error?.message || "Falha ao comentar." }, { status: 500 });
  }
}
