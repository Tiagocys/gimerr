import fs from "node:fs";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const VERIFY_BUTTON_CUSTOM_ID = "gimerr_verify_account";
const DISCORD_TEXT_CHANNEL_TYPE = 0;
const GUILDS_INTENT = 1;
const GUILD_MESSAGES_INTENT = 1 << 9;

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

function normalizeApiBase(value) {
  return String(value || "http://localhost:8788").replace(/\/+$/, "");
}

function normalizeCode(value) {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (text.startsWith("GM") && text.length >= 8) return text.slice(0, 8);
  const match = text.match(/[A-Z0-9]{6}/);
  return match ? `GM${match[0]}` : "";
}

function isVerifyCommand(value) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return ["verificar", "verify", "confirmar", "gimerr"].includes(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function sendChannelMessage(channelId, content) {
  return discordRequest(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

async function sendVerifyButtonMessage(channelId) {
  return discordRequest(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: [
        "**Verifique sua conta Gimerr**",
        "",
        "Clique no botão abaixo para receber seu link seguro de autenticação no Gimerr.",
        "Depois, entre com este mesmo Discord. A verificação usa o nível de segurança do servidor oficial.",
      ].join("\n"),
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              label: "Verify Gimerr Account",
              custom_id: VERIFY_BUTTON_CUSTOM_ID,
            },
          ],
        },
      ],
    }),
  });
}

async function getRecentChannelMessages(channelId) {
  return discordRequest(`/channels/${channelId}/messages?limit=50`, {
    method: "GET",
  });
}

function hasVerifyButton(message, botUserId) {
  if (!message || message.author?.id !== botUserId) return false;
  return (message.components || []).some((row) => (
    (row.components || []).some((component) => component.custom_id === VERIFY_BUTTON_CUSTOM_ID)
  ));
}

async function ensureVerifyButtonMessage(channelId, botUserId) {
  if (!channelId) {
    console.warn("[discord-verify-bot] DISCORD_VERIFY_CHANNEL_ID ausente; mensagem com botão não será criada automaticamente.");
    return;
  }

  const messages = await getRecentChannelMessages(channelId).catch((error) => {
    console.warn(`[discord-verify-bot] não foi possível buscar mensagens do canal de verificação: ${error.message}`);
    return [];
  });
  if (Array.isArray(messages) && messages.some((message) => hasVerifyButton(message, botUserId))) {
    console.log("[discord-verify-bot] mensagem de verificação já existe");
    return;
  }

  await sendVerifyButtonMessage(channelId);
  console.log("[discord-verify-bot] mensagem de verificação criada");
}

async function deleteChannelMessage(channelId, messageId) {
  if (!messageId) return;
  await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
  });
}

function scheduleVerifyCleanup(message, botMessage) {
  const deleteAfterMs = Number(process.env.DISCORD_VERIFY_DELETE_AFTER_MS || 15000);
  if (!Number.isFinite(deleteAfterMs) || deleteAfterMs <= 0) return;

  setTimeout(() => {
    deleteChannelMessage(message.channel_id, message.id).catch((error) => {
      console.warn(`[discord-verify-bot] não foi possível apagar mensagem do usuário: ${error.message}`);
    });
    deleteChannelMessage(message.channel_id, botMessage?.id).catch((error) => {
      console.warn(`[discord-verify-bot] não foi possível apagar resposta do bot: ${error.message}`);
    });
  }, deleteAfterMs);
}

async function verifyCode({ apiBase, token, message }) {
  const code = normalizeCode(message.content);
  if (!code && !isVerifyCommand(message.content)) return;

  const response = await fetch(`${apiBase}/api/discord/verify-account`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      code,
      discordId: message.author.id,
      discordUsername: message.author.global_name || message.author.username || "",
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (response.ok) {
    const botMessage = await sendChannelMessage(message.channel_id, `<@${message.author.id}> conta verificada no Gimerr.`);
    scheduleVerifyCleanup(message, botMessage);
    console.log(`[discord-verify-bot] verificado ${message.author.id}`);
    return;
  }

  const reason = payload.error || "Código inválido ou expirado.";
  const botMessage = await sendChannelMessage(message.channel_id, `<@${message.author.id}> ${reason}`);
  scheduleVerifyCleanup(message, botMessage);
  console.warn(`[discord-verify-bot] falha ${message.author.id}: ${reason}`);
}

async function callVerifyBackend({ apiBase, token, discordId, discordUsername = "" }) {
  const response = await fetch(`${apiBase}/api/discord/verification-session`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      discordId,
      discordUsername,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function respondInteraction(interaction, content, ephemeral = true) {
  const response = await fetch(`${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: 4,
      data: {
        content,
        flags: ephemeral ? 64 : 0,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Discord interaction HTTP ${response.status}`);
}

async function deferInteraction(interaction, ephemeral = true) {
  const response = await fetch(`${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: 5,
      data: {
        flags: ephemeral ? 64 : 0,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Discord interaction defer HTTP ${response.status}`);
}

async function editInteractionResponse(interaction, content, components = []) {
  const response = await fetch(`${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      content,
      components,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Discord interaction edit HTTP ${response.status}`);
}

async function handleVerifyInteraction({ apiBase, token, interaction }) {
  const component = interaction.data;
  if (component?.custom_id !== VERIFY_BUTTON_CUSTOM_ID) return;

  const user = interaction.member?.user || interaction.user;
  const discordId = user?.id;
  if (!discordId) {
    await respondInteraction(interaction, "Não consegui identificar seu Discord. Tente novamente.");
    return;
  }

  await deferInteraction(interaction);

  const { response, payload } = await callVerifyBackend({
    apiBase,
    token,
    discordId,
    discordUsername: user.global_name || user.username || "",
  });

  if (response.ok) {
    await editInteractionResponse(
      interaction,
      "Abra o Gimerr e entre com este mesmo Discord para concluir a verificação.",
      [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: "Open Gimerr Verification",
              url: payload.verifyUrl,
            },
          ],
        },
      ],
    );
    console.log(`[discord-verify-bot] sessão de verificação criada para ${discordId}`);
    return;
  }

  await editInteractionResponse(
    interaction,
    payload.error || "Não foi possível verificar sua conta Gimerr.",
  );
  console.warn(`[discord-verify-bot] falha por botão ${discordId}: ${payload.error || response.status}`);
}

async function getChannelName(channelId, cache) {
  if (cache.has(channelId)) return cache.get(channelId);
  const channel = await discordRequest(`/channels/${channelId}`);
  const name = channel.name || "";
  cache.set(channelId, name);
  return name;
}

async function shouldHandleMessage(message, channelCache) {
  if (!message?.content || message.author?.bot) return false;

  const configuredChannelId = process.env.DISCORD_VERIFY_CHANNEL_ID;
  if (configuredChannelId) return message.channel_id === configuredChannelId;

  const expectedName = process.env.DISCORD_VERIFY_CHANNEL_NAME || "verify";
  const channelName = await getChannelName(message.channel_id, channelCache).catch(() => "");
  return channelName === expectedName;
}

function connectGateway() {
  const apiBase = normalizeApiBase(
    process.env.GIMERR_API_BASE_URL
      || (process.env.NODE_ENV === "production" ? process.env.GIMERR_URL_PAGES : "")
      || "http://localhost:8788",
  );
  const token = requiredEnv("DISCORD_BOT_TOKEN");
  const channelCache = new Map();
  const ensuredVerifyChannels = new Set();
  const socket = new WebSocket(DISCORD_GATEWAY);
  let heartbeatTimer = null;
  let lastSequence = null;

  socket.addEventListener("open", () => {
    console.log("[discord-verify-bot] conectado ao gateway");
  });

  socket.addEventListener("message", async (event) => {
    const packet = JSON.parse(event.data);
    if (packet.s) lastSequence = packet.s;

    if (packet.op === 10) {
      heartbeatTimer = setInterval(() => {
        socket.send(JSON.stringify({ op: 1, d: lastSequence }));
      }, packet.d.heartbeat_interval);

      socket.send(JSON.stringify({
        op: 2,
        d: {
          token,
          intents: GUILDS_INTENT | GUILD_MESSAGES_INTENT,
          properties: {
            os: process.platform,
            browser: "gimerr",
            device: "gimerr",
          },
        },
      }));
      return;
    }

    if (packet.t === "READY") {
      console.log(`[discord-verify-bot] pronto como ${packet.d.user.username}`);
      socket.gimerrBotUserId = packet.d.user.id;
      await ensureVerifyButtonMessage(process.env.DISCORD_VERIFY_CHANNEL_ID, packet.d.user.id).catch((error) => {
        console.error("[discord-verify-bot] erro ao garantir mensagem de verificação", error);
      });
      return;
    }

    if (packet.t === "GUILD_CREATE" && !process.env.DISCORD_VERIFY_CHANNEL_ID) {
      const guild = packet.d;
      const configuredGuildId = process.env.DISCORD_GUILD_ID;
      if (configuredGuildId && guild.id !== configuredGuildId) return;

      const expectedName = process.env.DISCORD_VERIFY_CHANNEL_NAME || "verify";
      const channel = (guild.channels || []).find((item) => (
        item.type === DISCORD_TEXT_CHANNEL_TYPE && item.name === expectedName
      ));
      if (!channel || ensuredVerifyChannels.has(channel.id)) return;

      ensuredVerifyChannels.add(channel.id);
      await ensureVerifyButtonMessage(channel.id, socket.gimerrBotUserId || "").catch((error) => {
        console.error("[discord-verify-bot] erro ao garantir mensagem de verificação por nome do canal", error);
      });
      return;
    }

    if (packet.t === "INTERACTION_CREATE") {
      await handleVerifyInteraction({ apiBase, token, interaction: packet.d }).catch((error) => {
        console.error("[discord-verify-bot] erro ao processar botão de verificação", error);
      });
      return;
    }

    if (packet.t === "MESSAGE_CREATE") {
      const message = packet.d;
      if (await shouldHandleMessage(message, channelCache)) {
        await verifyCode({ apiBase, token, message }).catch((error) => {
          console.error("[discord-verify-bot] erro ao verificar código", error);
        });
      }
    }
  });

  socket.addEventListener("close", async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    console.warn("[discord-verify-bot] conexão encerrada, tentando reconectar em 5s");
    await sleep(5000);
    connectGateway();
  });

  socket.addEventListener("error", (error) => {
    console.error("[discord-verify-bot] erro no gateway", error);
  });
}

loadDotEnv();
connectGateway();
