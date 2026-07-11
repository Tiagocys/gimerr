import fs from "node:fs";

const DISCORD_API = "https://discord.com/api/v10";

function loadDotEnv() {
  if (!fs.existsSync(".env")) return;
  const lines = fs.readFileSync(".env", "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  });
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ausente no .env`);
  return value;
}

async function discordRequest(path, options = {}) {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      authorization: `Bot ${requiredEnv("DISCORD_BOT_TOKEN")}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Discord HTTP ${response.status}`);
  return payload;
}

async function createInvite() {
  const channelId = requiredEnv("DISCORD_VERIFY_CHANNEL_ID");
  const invite = await discordRequest(`/channels/${channelId}/invites`, {
    method: "POST",
    body: JSON.stringify({
      max_age: 0,
      max_uses: 0,
      temporary: false,
      unique: true,
      reason: "Gimerr official verification invite",
    }),
  });

  if (!invite?.code) {
    throw new Error("Discord não retornou código de convite.");
  }

  const url = `https://discord.gg/${invite.code}`;
  console.log(url);
}

loadDotEnv();
createInvite().catch((error) => {
  console.error(`[discord-create-invite] ${error.message}`);
  process.exit(1);
});
