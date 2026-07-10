const DEFAULT_DISCORD_SCOPES = "identify email connections guilds";

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

function getDiscordStateSecret(env) {
  return env.DISCORD_STATE_SECRET || env.DISCORD_CLIENT_SECRET || env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getDiscordRedirectUri(env, request) {
  return env.DISCORD_REDIRECT_URI || `${new URL(request.url).origin}/api/discord/callback`;
}

export function getDiscordScopes(env) {
  return env.DISCORD_SCOPES || DEFAULT_DISCORD_SCOPES;
}

export async function createDiscordState(env, payload) {
  const secret = getDiscordStateSecret(env);
  if (!secret) {
    throw new Error("Discord state secret missing");
  }

  const body = base64UrlEncode(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
    nonce: crypto.randomUUID(),
  }));
  const signature = base64UrlEncode(await hmacSha256(secret, body));
  return `${body}.${signature}`;
}

export async function verifyDiscordState(env, state) {
  const secret = getDiscordStateSecret(env);
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
    throw new Error("A conexão com o Discord expirou. Tente novamente.");
  }

  return payload;
}

export function getDiscordAuthorizeUrl(env, request, state) {
  const clientId = env.DISCORD_CLIENT_ID;
  if (!clientId) {
    throw new Error("DISCORD_CLIENT_ID ausente.");
  }

  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", getDiscordRedirectUri(env, request));
  authorizeUrl.searchParams.set("scope", getDiscordScopes(env));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "consent");
  return authorizeUrl.toString();
}

export async function exchangeDiscordCode(env, request, code) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
    throw new Error("Configuração Discord incompleta.");
  }

  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: getDiscordRedirectUri(env, request),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || "Não foi possível conectar com o Discord.");
  }

  return payload;
}

export async function fetchDiscordUser(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível carregar o usuário Discord.");
  }

  return payload;
}
