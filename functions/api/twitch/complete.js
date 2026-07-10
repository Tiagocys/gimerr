import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { verifyTwitchState } from "../../_shared/twitch_oauth.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const result = await verifyTwitchState(env, body.result);

    if (result.type !== "twitch_connection" || result.userId !== auth.user.id || !result.twitch?.id) {
      return jsonResponse({ error: "Resultado Twitch inválido." }, { status: 400 });
    }

    const supabaseRestUrl = getSupabaseRestUrl(env);
    const supabaseAnonKey = env.SUPABASE_ANON_KEY;
    if (!supabaseRestUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Auth config missing" }, { status: 500 });
    }

    const response = await fetch(`${supabaseRestUrl}/profile_platform_links?on_conflict=profile_id,platform`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({
        profile_id: auth.user.id,
        platform: "twitch",
        handle: result.twitch.handle,
        profile_url: result.twitch.profileUrl,
        external_user_id: result.twitch.id,
        is_public: true,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return jsonResponse({
        error: payload.message || "Não foi possível salvar a conexão Twitch.",
      }, { status: response.status });
    }

    return jsonResponse({
      ok: true,
      link: Array.isArray(payload) ? payload[0] : payload,
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível concluir a conexão Twitch.",
    }, { status: 500 });
  }
}
