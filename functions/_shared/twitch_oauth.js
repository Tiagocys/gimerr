const DEFAULT_TWITCH_SCOPES = "user:read:email";

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(String(value));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value) {
  const base64 = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function hmacSha256(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function getTwitchClientId(env) {
  return env.TWITCH_CLIENT_ID || env.TWITCH_CLIEND_ID;
}

function getTwitchStateSecret(env) {
  return env.TWITCH_STATE_SECRET || env.TWITCH_CLIENT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getTwitchRedirectUri(env, request) {
  return env.TWITCH_REDIRECT_URI || `${new URL(request.url).origin}/api/twitch/callback`;
}

export function getTwitchScopes(env) {
  return env.TWITCH_SCOPES || DEFAULT_TWITCH_SCOPES;
}

export async function createTwitchState(env, payload) {
  const secret = getTwitchStateSecret(env);
  if (!secret) {
    throw new Error("Twitch state secret missing");
  }

  const body = base64UrlEncode(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
    nonce: crypto.randomUUID(),
  }));
  const signature = base64UrlEncode(await hmacSha256(secret, body));
  return `${body}.${signature}`;
}

export async function verifyTwitchState(env, state) {
  const secret = getTwitchStateSecret(env);
  if (!secret || !state) {
    throw new Error("Estado OAuth inválido.");
  }

  const [body, signature] = String(state).split(".");
  if (!body || !signature) {
    throw new Error("Estado OAuth inválido.");
  }

  const expectedSignature = base64UrlEncode(await hmacSha256(secret, body));
  if (signature !== expectedSignature) {
    throw new Error("Estado OAuth inválido.");
  }

  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("A conexão com a Twitch expirou. Tente novamente.");
  }

  return payload;
}

export function getTwitchAuthorizeUrl(env, request, state) {
  const clientId = getTwitchClientId(env);
  if (!clientId) {
    throw new Error("TWITCH_CLIENT_ID ausente.");
  }

  const authorizeUrl = new URL("https://id.twitch.tv/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", getTwitchRedirectUri(env, request));
  authorizeUrl.searchParams.set("scope", getTwitchScopes(env));
  authorizeUrl.searchParams.set("state", state);
  return authorizeUrl.toString();
}

export async function exchangeTwitchCode(env, request, code) {
  const clientId = getTwitchClientId(env);
  if (!clientId || !env.TWITCH_CLIENT_SECRET) {
    throw new Error("Configuração Twitch incompleta.");
  }

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: env.TWITCH_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: getTwitchRedirectUri(env, request),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error_description || payload.error || "Não foi possível conectar com a Twitch.");
  }

  return payload;
}

export async function fetchTwitchUser(env, accessToken) {
  const clientId = getTwitchClientId(env);
  const response = await fetch("https://api.twitch.tv/helix/users", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "client-id": clientId,
      accept: "application/json",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível carregar o usuário Twitch.");
  }

  const [user] = payload.data || [];
  if (!user?.id) {
    throw new Error("Usuário Twitch não encontrado.");
  }

  return user;
}
