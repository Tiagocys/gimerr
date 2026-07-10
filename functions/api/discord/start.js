import { jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { createDiscordState, getDiscordAuthorizeUrl, getDiscordRedirectUri } from "../../_shared/discord_oauth.js";

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const redirectPath = typeof body.redirectPath === "string" && body.redirectPath.startsWith("/")
      ? body.redirectPath
      : "/edit-profile";
    const redirectUri = getDiscordRedirectUri(env, request);
    const state = await createDiscordState(env, {
      userId: auth.user.id,
      redirectPath,
      redirectUri,
    });

    return jsonResponse({
      authorizeUrl: getDiscordAuthorizeUrl(env, request, state),
    });
  } catch (error) {
    return jsonResponse({
      error: error?.message || "Não foi possível iniciar a conexão com o Discord.",
    }, { status: 500 });
  }
}
