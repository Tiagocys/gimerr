import { getSupabaseRestUrl, getSupabaseUrl, jsonResponse } from "../../_shared/auth.js";
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

async function getOptionalAuthUser(request, env) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;

  const supabaseUrl = getSupabaseUrl(env);
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      authorization,
    },
  });
  const user = await response.json().catch(() => null);
  return response.ok ? user : null;
}

export async function onRequestPost({ request, env }) {
  try {
    const payload = await request.json().catch(() => ({}));
    const postId = cleanUuid(payload.postId);
    const viewerToken = cleanText(payload.viewerToken, 128);
    if (!postId) {
      return jsonResponse({ error: "Post inválido." }, { status: 400 });
    }

    const user = await getOptionalAuthUser(request, env);
    if (!user?.id && !viewerToken) {
      return jsonResponse({ error: "Identificador de visualização ausente." }, { status: 400 });
    }

    const response = await fetch(`${getSupabaseRestUrl(env)}/rpc/record_feed_post_video_view`, {
      method: "POST",
      headers: getServiceHeaders(env),
      body: JSON.stringify({
        p_post_id: postId,
        p_viewer_id: user?.id || null,
        p_viewer_token: user?.id ? null : viewerToken,
      }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || "Não foi possível registrar visualização.");

    return jsonResponse({ videoViewCount: Number(result || 0) });
  } catch (error) {
    console.error("video view failed", error);
    return jsonResponse({ error: error?.message || "Falha ao registrar visualização." }, { status: 500 });
  }
}
