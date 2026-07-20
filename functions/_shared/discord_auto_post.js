import { getSupabaseRestUrl } from "./auth.js";
import { getServiceHeaders } from "./admin.js";

const DISCORD_API = "https://discord.com/api/v10";

function cleanText(value, maxLength = 200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeSnowflake(value) {
  const text = String(value || "").trim();
  return /^[0-9]{17,20}$/.test(text) ? text : "";
}

function getPublicBaseUrl(env) {
  return String(
    env.GIMERR_PUBLIC_URL
      || env.GIMERR_URL
      || env.GIMERR_API_BASE_URL
      || env.GIMERR_URL_PAGES
      || "https://gimerr.com"
  ).replace(/\/+$/, "");
}

function toAbsolutePublicUrl(env, value) {
  const url = cleanText(value, 500);
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${getPublicBaseUrl(env)}${url}`;
  return `${getPublicBaseUrl(env)}/${url.replace(/^\/+/, "")}`;
}

function getPostContentType(postType) {
  return postType === "listing" ? "listing" : "post";
}

function getDiscordBotToken(env) {
  return String(env.DISCORD_BOT_TOKEN || "").trim();
}

async function fetchSingle(env, table, params) {
  const url = new URL(`${getSupabaseRestUrl(env)}/${table}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || `Não foi possível carregar ${table}.`);
  return rows[0] || null;
}

async function fetchRows(env, table, params) {
  const url = new URL(`${getSupabaseRestUrl(env)}/${table}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || `Não foi possível carregar ${table}.`);
  return rows;
}

async function insertDispatch(env, postId, subscriptionId) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/discord_post_dispatches?on_conflict=post_id,subscription_id`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "resolution=ignore-duplicates,return=representation" }),
    body: JSON.stringify({
      post_id: postId,
      subscription_id: subscriptionId,
      status: "pending",
    }),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível registrar envio ao Discord.");
  return rows[0] || null;
}

async function patchDispatch(env, dispatchId, payload) {
  if (!dispatchId) return;
  const url = new URL(`${getSupabaseRestUrl(env)}/discord_post_dispatches`);
  url.searchParams.set("id", `eq.${dispatchId}`);
  await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify(payload),
  });
}

async function disableSubscription(env, subscriptionId, error) {
  const url = new URL(`${getSupabaseRestUrl(env)}/discord_channel_subscriptions`);
  url.searchParams.set("id", `eq.${subscriptionId}`);
  await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify({
      enabled: false,
      updated_at: new Date().toISOString(),
    }),
  }).catch(() => {});
  console.warn(`[discord-auto-post] assinatura desativada ${subscriptionId}: ${error}`);
}

async function sendDiscordMessage(env, channelId, payload) {
  const token = getDiscordBotToken(env);
  if (!token) throw new Error("DISCORD_BOT_TOKEN ausente.");

  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bot ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Discord HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function getListingItems(mediaItems) {
  return (Array.isArray(mediaItems) ? mediaItems : [])
    .filter((item) => cleanText(item?.itemName, 120) || cleanText(item?.priceLabel, 80))
    .sort((left, right) => Number(left?.position ?? 0) - Number(right?.position ?? 0));
}

function getPrimaryImageUrl(post) {
  const items = Array.isArray(post.media_items) ? post.media_items : [];
  const imageItem = items.find((item) => String(item?.mediaType || "").startsWith("image/") && item?.url);
  if (imageItem?.url) return imageItem.url;
  if (String(post.media_type || "").startsWith("image/") && post.media_url) return post.media_url;
  if (post.post_type !== "listing" && post.video_thumbnail_url) return post.video_thumbnail_url;
  return post.game_cover_url || "";
}

function buildDiscordPayload(env, post) {
  const postUrl = `${getPublicBaseUrl(env)}/post?id=${encodeURIComponent(post.id)}`;
  const authorName = cleanText(post.display_name || post.username || "Usuário Gimerr", 80);
  const gameName = cleanText(post.game_name || "Game", 120);
  const isListing = post.post_type === "listing";
  const listingItems = getListingItems(post.media_items);
  const descriptionParts = [];

  if (post.body) descriptionParts.push(cleanText(post.body, isListing ? 500 : 700));
  if (isListing && listingItems.length) {
    descriptionParts.push(listingItems
      .slice(0, 6)
      .map((item) => {
        const name = cleanText(item?.itemName, 80);
        const price = cleanText(item?.priceLabel, 50);
        return price ? `• ${name} — ${price}` : `• ${name}`;
      })
      .join("\n"));
  }

  const embed = {
    title: isListing ? `Anúncio em ${gameName}` : `Novo post em ${gameName}`,
    url: postUrl,
    description: descriptionParts.join("\n\n").slice(0, 1200) || `Publicado por ${authorName}.`,
    color: isListing ? 0x58aaff : 0x02132b,
    footer: { text: `Gimerr • ${authorName}` },
    timestamp: post.created_at || new Date().toISOString(),
  };
  const imageUrl = getPrimaryImageUrl(post);
  const absoluteImageUrl = toAbsolutePublicUrl(env, imageUrl);
  if (absoluteImageUrl) embed.image = { url: absoluteImageUrl };

  return {
    content: isListing ? "Novo anúncio publicado no Gimerr." : "Novo post publicado no Gimerr.",
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: isListing ? "Ver anúncio no Gimerr" : "Ver post no Gimerr",
            url: postUrl,
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export async function dispatchPostToDiscord(env, postId) {
  const normalizedPostId = cleanText(postId, 80);
  if (!normalizedPostId) return { ok: false, skipped: true, reason: "missing_post_id" };

  const post = await fetchSingle(env, "public_feed_posts", {
    select: "*",
    id: `eq.${normalizedPostId}`,
  });
  if (!post?.id) return { ok: true, skipped: true, reason: "post_not_found" };
  if (post.post_type !== "listing") return { ok: true, skipped: true, reason: "marketplace_only" };

  const contentType = getPostContentType(post.post_type);
  const subscriptions = await fetchRows(env, "discord_channel_subscriptions", {
    select: "id,channel_id,channel_name,guild_id,game_igdb_id,content_type,enabled",
    game_igdb_id: `eq.${post.game_igdb_id}`,
    content_type: `eq.${contentType}`,
    enabled: "eq.true",
    limit: "100",
  });
  if (!subscriptions.length) return { ok: true, skipped: true, reason: "no_subscriptions" };

  const payload = buildDiscordPayload(env, post);
  const results = [];

  for (const subscription of subscriptions) {
    const channelId = normalizeSnowflake(subscription.channel_id);
    if (!channelId) continue;
    const dispatch = await insertDispatch(env, post.id, subscription.id);
    if (!dispatch?.id) {
      results.push({ subscriptionId: subscription.id, skipped: true, reason: "already_dispatched" });
      continue;
    }

    try {
      const message = await sendDiscordMessage(env, channelId, payload);
      await patchDispatch(env, dispatch.id, {
        status: "sent",
        discord_message_id: normalizeSnowflake(message?.id) || null,
        error: null,
      });
      results.push({ subscriptionId: subscription.id, status: "sent", messageId: message?.id || null });
    } catch (error) {
      await patchDispatch(env, dispatch.id, {
        status: "failed",
        error: cleanText(error?.message || "Falha ao enviar para o Discord.", 500),
      });
      if (error?.status === 403 || error?.status === 404) {
        await disableSubscription(env, subscription.id, error.message);
      }
      results.push({ subscriptionId: subscription.id, status: "failed", error: error?.message || String(error) });
    }
  }

  return { ok: true, results };
}
