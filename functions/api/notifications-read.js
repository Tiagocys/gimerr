import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../_shared/auth.js";
import { getServiceHeaders } from "../_shared/admin.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env, { allowRestricted: true });
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const id = cleanText(payload.id, 80);
    const now = new Date().toISOString();
    const url = new URL(`${getSupabaseRestUrl(env)}/notifications`);

    if (id) {
      url.searchParams.set("id", `eq.${id}`);
    }
    url.searchParams.set("recipient_id", `eq.${auth.user.id}`);
    url.searchParams.set("read_at", "is.null");

    const response = await fetch(url.toString(), {
      method: "PATCH",
      headers: getServiceHeaders(env, {
        prefer: "return=minimal",
      }),
      body: JSON.stringify({ read_at: now }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || "Não foi possível marcar notificações como lidas.");
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("notifications-read failed", error);
    return jsonResponse({ error: error?.message || "Falha ao atualizar notificações." }, { status: 500 });
  }
}
