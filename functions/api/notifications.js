import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../_shared/auth.js";
import { getServiceHeaders } from "../_shared/admin.js";

function toPublicNotification(notification) {
  return {
    id: notification.id,
    senderName: notification.sender_name,
    senderAvatarUrl: notification.sender_avatar_url,
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
    url.searchParams.set("order", "created_at.desc");
    url.searchParams.set("limit", String(limit));

    const unreadUrl = new URL(`${restUrl}/notifications`);
    unreadUrl.searchParams.set("select", "id,type,data");
    unreadUrl.searchParams.set("recipient_id", `eq.${auth.user.id}`);
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
    return jsonResponse({
      unreadCount,
      notifications: rows.map(toPublicNotification),
    });
  } catch (error) {
    console.error("notifications failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar notificações." }, { status: 500 });
  }
}
