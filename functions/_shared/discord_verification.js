export function cleanDiscordId(value) {
  return String(value || "")
    .replace(/\D+/g, "")
    .slice(0, 32);
}

export function cleanDiscordText(value, maxLength = 80) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function validateBotRequest(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^bearer\s+/i, "");
  return Boolean(env.DISCORD_BOT_TOKEN && token && token === env.DISCORD_BOT_TOKEN);
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

export function makeVerificationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${crypto.randomUUID()}.${encoded}`;
}

export function getPublicBaseUrl(request, env) {
  const configured = env.GIMERR_PUBLIC_URL || env.GIMERR_URL || env.GIMERR_API_BASE_URL || env.GIMERR_URL_PAGES || "";
  return String(configured || new URL(request.url).origin).replace(/\/+$/, "");
}
