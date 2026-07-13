import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../_shared/auth.js";
import { getServiceHeaders } from "../_shared/admin.js";

function isGoogleAvatarUrl(value) {
  return String(value || "").includes("googleusercontent.com");
}

function sanitizeAvatarUrl(value) {
  const url = String(value || "").trim();
  if (!url || isGoogleAvatarUrl(url)) return "";
  return url;
}

function cleanUuid(value) {
  return String(value || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
}

function inFilter(values) {
  return `in.(${[...new Set(values.filter(Boolean))].join(",")})`;
}

function getNotificationSenderProfileId(notification) {
  const data = notification?.data || {};
  return cleanUuid(data.author_id || data.sender_id || "");
}

async function fetchNotificationProfiles(env, notifications) {
  const ids = notifications.map(getNotificationSenderProfileId).filter(Boolean);
  if (!ids.length) return new Map();

  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,display_name,username,avatar_url");
  url.searchParams.set("id", inFilter(ids));

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    console.warn("Não foi possível hidratar perfis das notificações.", rows.message || rows);
    return new Map();
  }
  return new Map(rows.map((profile) => [profile.id, profile]));
}

function toPublicNotification(notification, profilesById) {
  const senderProfile = profilesById.get(getNotificationSenderProfileId(notification));
  const senderName = senderProfile
    ? (senderProfile.display_name || senderProfile.username || notification.sender_name)
    : notification.sender_name;
  const senderAvatarUrl = senderProfile
    ? sanitizeAvatarUrl(senderProfile.avatar_url)
    : sanitizeAvatarUrl(notification.sender_avatar_url);

  return {
    id: notification.id,
    senderName,
    senderAvatarUrl,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    actionUrl: notification.action_url,
    data: notification.data || {},
    readAt: notification.read_at,
    createdAt: notification.created_at,
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env, { allowRestricted: true });
    if (auth.error) return auth.error;

    const pageUrl = new URL(request.url);
    const limit = Math.min(Math.max(Number(pageUrl.searchParams.get("limit")) || 20, 1), 50);

    const restUrl = getSupabaseRestUrl(env);
    const url = new URL(`${restUrl}/notifications`);
    url.searchParams.set("select", "id,sender_name,sender_avatar_url,type,title,body,action_url,data,read_at,created_at");
    url.searchParams.set("recipient_id", `eq.${auth.user.id}`);
    url.searchParams.set("type", "neq.direct_message");
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", String(limit));

    const unreadUrl = new URL(`${restUrl}/notifications`);
    unreadUrl.searchParams.set("select", "id,type,data");
    unreadUrl.searchParams.set("recipient_id", `eq.${auth.user.id}`);
    unreadUrl.searchParams.set("type", "neq.direct_message");
    unreadUrl.searchParams.set("read_at", "is.null");

    const [response, unreadResponse] = await Promise.all([
      fetch(url.toString(), {
        headers: getServiceHeaders(env),
      }),
      fetch(unreadUrl.toString(), {
        headers: getServiceHeaders(env),
      }),
    ]);
    const rows = await response.json().catch(() => []);
    const unreadRows = await unreadResponse.json().catch(() => []);

    if (!response.ok) {
      throw new Error(rows.message || "Não foi possível carregar notificações.");
    }

    if (!unreadResponse.ok) {
      throw new Error("Não foi possível carregar contador de notificações.");
    }

    const unreadCount = (unreadRows || []).reduce((total, notification) => {
      if (notification.type === "post_comment") {
        return total + Math.max(1, Number(notification.data?.comment_count || 1));
      }
      return total + 1;
    }, 0);
    const profilesById = await fetchNotificationProfiles(env, rows);
    return jsonResponse({
      unreadCount,
      notifications: rows.map((notification) => toPublicNotification(notification, profilesById)),
    });
  } catch (error) {
    console.error("notifications failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar notificações." }, { status: 500 });
  }
}
