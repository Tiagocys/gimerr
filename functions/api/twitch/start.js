import { jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { createTwitchState, getTwitchAuthorizeUrl, getTwitchRedirectUri } from "../../_shared/twitch_oauth.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const redirectPath = typeof body.redirectPath === "string" && body.redirectPath.startsWith("/")
      ? body.redirectPath
      : "/edit-profile";
    const state = await createTwitchState(env, {
      userId: auth.user.id,
      redirectPath,
      redirectUri: getTwitchRedirectUri(env, request),
    });

    return jsonResponse({
      authorizeUrl: getTwitchAuthorizeUrl(env, request, state),
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível iniciar a conexão com a Twitch.",
    }, { status: 500 });
  }
}
