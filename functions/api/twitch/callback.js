import { jsonResponse } from "../../_shared/auth.js";
import { createTwitchState, exchangeTwitchCode, fetchTwitchUser, verifyTwitchState } from "../../_shared/twitch_oauth.js";

function getRedirectResponse(request, redirectPath, params) {
  const url = new URL(request.url);
  url.pathname = redirectPath || "/edit-profile";
  url.search = "";
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return Response.redirect(url.toString(), 302);
}

function getTwitchHandle(twitchUser) {
  return twitchUser.display_name ? `@${twitchUser.display_name}` : `@${twitchUser.login}`;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  let redirectPath = "/edit-profile";

  try {
    const statePayload = await verifyTwitchState(env, state);
    redirectPath = statePayload.redirectPath || redirectPath;

    if (oauthError) {
      return getRedirectResponse(request, redirectPath, {
        twitch: "cancelled",
      });
    }

    if (!code) {
      throw new Error("Código de autorização ausente.");
    }

    const tokenPayload = await exchangeTwitchCode(env, request, code);
    const twitchUser = await fetchTwitchUser(env, tokenPayload.access_token);
    const result = await createTwitchState(env, {
      type: "twitch_connection",
      userId: statePayload.userId,
      twitch: {
        id: twitchUser.id,
        handle: getTwitchHandle(twitchUser),
        profileUrl: `https://www.twitch.tv/${twitchUser.login}`,
      },
    });

    return getRedirectResponse(request, redirectPath, {
      twitch: "complete",
      result,
    });
  } catch (error) {
    return getRedirectResponse(request, redirectPath, {
      twitch: "error",
      message: error?.message || "Não foi possível conectar a Twitch.",
    });
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Método não permitido." }, { status: 405 });
}
