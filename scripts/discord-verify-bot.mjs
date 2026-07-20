import fs from "node:fs";
import WebSocket from "ws";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const VERIFY_BUTTON_CUSTOM_ID = "gimerr_verify_account";
const DISCORD_TEXT_CHANNEL_TYPE = 0;
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2;
const DISCORD_INTERACTION_MESSAGE_COMPONENT = 3;
const DISCORD_INTERACTION_APPLICATION_COMMAND_AUTOCOMPLETE = 4;
const GUILDS_INTENT = 1;
const GUILD_MESSAGES_INTENT = 1 << 9;
const MANAGE_CHANNELS_PERMISSION = 0x10n;
const MANAGE_GUILD_PERMISSION = 0x20n;

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

function getCommunityCommandDefinition() {
  return {
    name: "gimerr",
    description: "Configure automatic Gimerr Marketplace listings in this channel.",
    default_member_permissions: String(MANAGE_CHANNELS_PERMISSION | MANAGE_GUILD_PERMISSION),
    dm_permission: false,
    options: [
      {
        type: 1,
        name: "setup",
        description: "Automatically publish Marketplace listings from a game in this channel.",
        options: [
          {
            type: 3,
            name: "game",
            description: "Game name or Gimerr game ID.",
            required: true,
            autocomplete: true,
          },
        ],
      },
      {
        type: 1,
        name: "remove",
        description: "Remove automatic Marketplace listings from this channel.",
        options: [
          {
            type: 3,
            name: "game",
            description: "Game name or Gimerr game ID.",
            required: true,
            autocomplete: true,
          },
        ],
      },
      {
        type: 1,
        name: "status",
        description: "List active automatic publications in this channel.",
      },
    ],
  };
}

async function ensureCommunityCommand(applicationId, guildId = "") {
  if (!applicationId) return;
  const basePath = guildId
    ? `/applications/${applicationId}/guilds/${guildId}/commands`
    : `/applications/${applicationId}/commands`;
  const command = getCommunityCommandDefinition();
  const commands = await discordRequest(basePath, { method: "GET" }).catch((error) => {
    console.warn(`[discord-verify-bot] não foi possível listar comandos: ${error.message}`);
    return [];
  });
  const existing = Array.isArray(commands)
    ? commands.find((item) => item.name === command.name)
    : null;
  if (existing?.id) {
    await discordRequest(`${basePath}/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify(command),
    });
  } else {
    await discordRequest(basePath, {
      method: "POST",
      body: JSON.stringify(command),
    });
  }
  console.log(`[discord-verify-bot] comando /gimerr sincronizado${guildId ? ` na guild ${guildId}` : " globalmente"}`);
}

async function ensureCommunityCommands(applicationId, readyGuilds = []) {
  const configuredGuildId = process.env.DISCORD_COMMAND_GUILD_ID || "";
  const guildIds = configuredGuildId
    ? [configuredGuildId]
    : [...new Set((Array.isArray(readyGuilds) ? readyGuilds : [])
      .map((guild) => guild?.id)
      .filter(Boolean))];

  if (!guildIds.length) {
    await ensureCommunityCommand(applicationId);
    return;
  }

  for (const guildId of guildIds) {
    await ensureCommunityCommand(applicationId, guildId).catch((error) => {
      console.warn(`[discord-verify-bot] não foi possível sincronizar /gimerr na guild ${guildId}: ${error.message}`);
    });
  }
}

async function sendChannelMessage(channelId, content) {
  return discordRequest(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

function getSignInUrl() {
  const baseUrl = normalizeApiBase(
    process.env.GIMERR_PUBLIC_URL
      || process.env.GIMERR_URL
      || process.env.GIMERR_API_BASE_URL
      || (process.env.NODE_ENV === "production" ? process.env.GIMERR_URL_PAGES : "")
      || "http://localhost:8788",
  );
  return `${baseUrl}/sign-in.html`;
}

async function sendVerifyButtonMessage(channelId) {
  return discordRequest(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: [
        "**Getting Started**",
        "",
        "To access Gimerr posting features, you need to verify your Gimerr account with Discord.",
        "",
        "Click a button below to get started:",
      ].join("\n"),
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 1,
              label: "Verify with Gimerr",
              custom_id: VERIFY_BUTTON_CUSTOM_ID,
            },
            {
              type: 2,
              style: 5,
              label: "Create a Gimerr account",
              url: getSignInUrl(),
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

async function respondAutocomplete(interaction, choices = []) {
  const response = await fetch(`${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: 8,
      data: {
        choices: choices.slice(0, 25).map((choice) => ({
          name: String(choice.name || "").slice(0, 100),
          value: String(choice.value || choice.name || "").slice(0, 100),
        })),
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Discord autocomplete HTTP ${response.status}`);
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

  try {
    await deferInteraction(interaction);
  } catch (error) {
    console.error(`[discord-verify-bot] não foi possível responder a interação ${interaction.id} a tempo`, error);
    return;
  }

  let response;
  let payload;
  try {
    ({ response, payload } = await callVerifyBackend({
      apiBase,
      token,
      discordId,
      discordUsername: user.global_name || user.username || "",
    }));
  } catch (error) {
    await editInteractionResponse(
      interaction,
      "Não foi possível criar seu link de verificação agora. Tente novamente em alguns instantes.",
    ).catch((editError) => {
      console.error("[discord-verify-bot] não foi possível editar resposta de falha", editError);
    });
    console.error(`[discord-verify-bot] backend indisponível para ${discordId}`, error);
    return;
  }

  if (response.ok) {
    await editInteractionResponse(
      interaction,
      "",
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

function getInteractionSubcommand(interaction) {
  return Array.isArray(interaction?.data?.options) ? interaction.data.options[0] : null;
}

function getInteractionOption(options, name) {
  const option = (Array.isArray(options) ? options : []).find((item) => item.name === name);
  return option?.value;
}

function findFocusedOption(options = []) {
  for (const option of Array.isArray(options) ? options : []) {
    if (option.focused) return option;
    const child = findFocusedOption(option.options);
    if (child) return child;
  }
  return null;
}

async function fetchGameAutocompleteChoices(apiBase, query) {
  const term = String(query || "").trim();
  if (term.length < 2) return [];

  const response = await fetch(`${apiBase}/api/games/search?q=${encodeURIComponent(term)}&limit=12`, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Gimerr search HTTP ${response.status}`);
  const games = Array.isArray(payload.games) ? payload.games : [];
  return games
    .filter((game) => game?.name)
    .map((game) => ({
      name: game.name,
      value: game.name,
    }));
}

async function callChannelSubscriptionBackend({ apiBase, token, interaction, action, contentType = "", gameQuery = "" }) {
  const user = interaction.member?.user || interaction.user || {};
  const response = await fetch(`${apiBase}/api/discord/channel-subscriptions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      action,
      contentType,
      gameQuery,
      discordUserId: user.id,
      discordUsername: user.global_name || user.username || "",
      guildId: interaction.guild_id,
      guildName: interaction.guild?.name || "",
      channelId: interaction.channel_id,
      channelName: interaction.channel?.name || "",
      memberPermissions: interaction.member?.permissions || "0",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function getContentTypeLabel(contentType) {
  if (contentType === "listing") return "anúncios do Marketplace";
  return "conteúdos";
}

function formatStatusResponse(subscriptions = []) {
  if (!subscriptions.length) {
    return "Este canal ainda não tem publicações automáticas configuradas.";
  }
  const rows = subscriptions.map((item) => {
    const gameName = item.gameName || `Jogo ${item.gameId}`;
    return `• ${gameName}: ${getContentTypeLabel(item.contentType)}`;
  });
  return ["Publicações automáticas ativas neste canal:", ...rows].join("\n");
}

async function handleCommunityCommandInteraction({ apiBase, token, interaction }) {
  if (interaction.type !== DISCORD_INTERACTION_APPLICATION_COMMAND || interaction.data?.name !== "gimerr") return;

  const subcommand = getInteractionSubcommand(interaction);
  const action = subcommand?.name || "";
  if (!["setup", "configurar", "remove", "remover", "status"].includes(action)) {
    await respondInteraction(interaction, "Comando Gimerr inválido.");
    return;
  }

  try {
    await deferInteraction(interaction);
  } catch (error) {
    console.error(`[discord-verify-bot] não foi possível responder comando ${interaction.id} a tempo`, error);
    return;
  }

  const gameQuery = getInteractionOption(subcommand?.options, "game") || getInteractionOption(subcommand?.options, "jogo") || "";
  const apiAction = action === "setup" || action === "configurar" ? "configure" : action === "remove" || action === "remover" ? "remove" : "status";

  let results;
  try {
    results = [await callChannelSubscriptionBackend({
      apiBase,
      token,
      interaction,
      action: apiAction,
      contentType: "listing",
      gameQuery,
    })];
  } catch (error) {
    await editInteractionResponse(interaction, "Não consegui falar com o Gimerr agora. Tente novamente em alguns instantes.").catch(() => {});
    console.error("[discord-verify-bot] backend indisponível para configuração de canal", error);
    return;
  }

  const failedResult = results.find((result) => !result.response.ok);
  if (failedResult) {
    await editInteractionResponse(interaction, failedResult.payload.error || "Não foi possível configurar este canal.");
    return;
  }

  if (apiAction === "status") {
    const payload = results[0]?.payload || {};
    await editInteractionResponse(interaction, formatStatusResponse(payload.subscriptions || []));
    return;
  }

  if (apiAction === "remove") {
    const gameName = results.find((result) => result.payload?.game?.name)?.payload?.game?.name || gameQuery;
    const removedCount = results.reduce((total, result) => total + Number(result.payload?.removed || 0), 0);
    const labels = results.map((result) => getContentTypeLabel(result.payload?.contentType || "listing"));
    const message = removedCount
      ? `Pronto. Este canal não receberá mais ${labels.join(" e ")} de ${gameName}.`
      : `Não encontrei uma configuração ativa para ${labels.join(" ou ")} de ${gameName} neste canal.`;
    await editInteractionResponse(interaction, message);
    return;
  }

  const gameName = results.find((result) => result.payload?.game?.name || result.payload?.subscription?.gameName)?.payload?.game?.name
    || results.find((result) => result.payload?.subscription?.gameName)?.payload?.subscription?.gameName
    || gameQuery;
  const labels = results.map((result) => getContentTypeLabel(result.payload?.contentType || "listing"));
  await editInteractionResponse(
    interaction,
    `Pronto. Este canal receberá automaticamente ${labels.join(" e ")} de ${gameName}.`,
  );
}

async function handleCommunityCommandAutocomplete({ apiBase, interaction }) {
  if (interaction.type !== DISCORD_INTERACTION_APPLICATION_COMMAND_AUTOCOMPLETE || interaction.data?.name !== "gimerr") return;

  const focused = findFocusedOption(interaction.data?.options);
  if (focused?.name !== "game") {
    await respondAutocomplete(interaction, []);
    return;
  }

  try {
    const choices = await fetchGameAutocompleteChoices(apiBase, focused.value);
    await respondAutocomplete(interaction, choices);
  } catch (error) {
    console.warn(`[discord-verify-bot] autocomplete de jogos indisponível: ${error.message}`);
    await respondAutocomplete(interaction, []).catch(() => {});
  }
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

  const expectedName = process.env.DISCORD_VERIFY_CHANNEL_NAME || "gimerr-verification";
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

  socket.on("open", () => {
    console.log("[discord-verify-bot] conectado ao gateway");
  });

  socket.on("message", async (data) => {
    const packet = JSON.parse(data.toString());
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
      socket.gimerrApplicationId = packet.d.application?.id || packet.d.user.id;
      await ensureCommunityCommands(socket.gimerrApplicationId, packet.d.guilds || []).catch((error) => {
        console.error("[discord-verify-bot] erro ao sincronizar comando /gimerr", error);
      });
      await ensureVerifyButtonMessage(process.env.DISCORD_VERIFY_CHANNEL_ID, packet.d.user.id).catch((error) => {
        console.error("[discord-verify-bot] erro ao garantir mensagem de verificação", error);
      });
      return;
    }

    if (packet.t === "GUILD_CREATE") {
      const guild = packet.d;
      if (socket.gimerrApplicationId) {
        await ensureCommunityCommand(socket.gimerrApplicationId, guild.id).catch((error) => {
          console.warn(`[discord-verify-bot] não foi possível sincronizar /gimerr na guild ${guild.id}: ${error.message}`);
        });
      }
      if (process.env.DISCORD_VERIFY_CHANNEL_ID) return;

      const configuredGuildId = process.env.DISCORD_GUILD_ID;
      if (configuredGuildId && guild.id !== configuredGuildId) return;

      const expectedName = process.env.DISCORD_VERIFY_CHANNEL_NAME || "gimerr-verification";
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
      if (packet.d.type === DISCORD_INTERACTION_MESSAGE_COMPONENT) {
        handleVerifyInteraction({ apiBase, token, interaction: packet.d }).catch((error) => {
          console.error("[discord-verify-bot] erro ao processar botão de verificação", error);
        });
      } else if (packet.d.type === DISCORD_INTERACTION_APPLICATION_COMMAND) {
        handleCommunityCommandInteraction({ apiBase, token, interaction: packet.d }).catch((error) => {
          console.error("[discord-verify-bot] erro ao processar comando do Gimerr", error);
        });
      } else if (packet.d.type === DISCORD_INTERACTION_APPLICATION_COMMAND_AUTOCOMPLETE) {
        handleCommunityCommandAutocomplete({ apiBase, interaction: packet.d }).catch((error) => {
          console.error("[discord-verify-bot] erro ao processar autocomplete do Gimerr", error);
        });
      }
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

  socket.on("close", async () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    console.warn("[discord-verify-bot] conexão encerrada, tentando reconectar em 5s");
    await sleep(5000);
    connectGateway();
  });

  socket.on("error", (error) => {
    console.error("[discord-verify-bot] erro no gateway", error);
  });
}

loadDotEnv();
connectGateway();
