import { jsonResponse } from "../../_shared/auth.js";
import { createDiscordState, exchangeDiscordCode, fetchDiscordUser, verifyDiscordState } from "../../_shared/discord_oauth.js";

function getRedirectResponse(request, redirectPath, params) {
  const url = new URL(request.url);
  url.pathname = redirectPath || "/edit-profile";
  url.search = "";
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return Response.redirect(url.toString(), 302);
}

function getDiscordHandle(discordUser) {
  const displayName = discordUser.global_name || discordUser.username;
  return displayName ? `@${displayName}` : "@discord";
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  let redirectPath = "/edit-profile";

  try {
    const statePayload = await verifyDiscordState(env, state);
    redirectPath = statePayload.redirectPath || redirectPath;

    if (oauthError) {
      return getRedirectResponse(request, redirectPath, {
        discord: "cancelled",
      });
    }

    if (!code) {
      throw new Error("Código de autorização ausente.");
    }

    const tokenPayload = await exchangeDiscordCode(env, request, code);
    const discordUser = await fetchDiscordUser(tokenPayload.access_token);
    const result = await createDiscordState(env, {
      type: "discord_connection",
      userId: statePayload.userId,
      discord: {
        id: discordUser.id,
        handle: getDiscordHandle(discordUser),
        profileUrl: `https://discord.com/users/${discordUser.id}`,
      },
    });

    return getRedirectResponse(request, redirectPath, {
      discord: "complete",
      result,
    });
  } catch (error) {
    return getRedirectResponse(request, redirectPath, {
      discord: "error",
      message: error?.message || "Não foi possível conectar o Discord.",
    });
  }
}

export async function onRequestPost() {
  return jsonResponse({ error: "Método não permitido." }, { status: 405 });
}
