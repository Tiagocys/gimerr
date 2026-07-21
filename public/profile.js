const profileInfo = {
  id: "",
  displayName: "",
  username: "",
  avatarUrl: "",
  phone: "",
  phoneVisibility: "private",
  phoneContactWhatsapp: false,
  phoneContactTelegram: false,
  connectedAccounts: [],
};

const GIMERR_SYSTEM_PROFILE_ID = "00000000-0000-4000-8000-000000000001";
const GIMERR_SYSTEM_USERNAMES = new Set(["gimerr_app", "app_gimerr"]);

const state = {
  session: null,
  loading: true,
  recommended: false,
  recommendationCount: 0,
  postsCount: 0,
  recommendations: [],
  posts: [],
  feedFilter: "all",
  profileMissing: false,
  activeCommentPostId: "",
  activeCommentsPostId: "",
  commentSubmittingPostId: "",
  editingPostId: "",
  editSubmittingPostId: "",
  replyingToCommentId: "",
  commentsLoadingPostId: "",
  commentsByPost: {},
  commentsErrorByPost: {},
  followedProfiles: [],
  listingSellerCache: new Map(),
  commentMention: {
    active: false,
    start: -1,
    end: -1,
    selectedIndex: 0,
    items: [],
    textarea: null,
  },
};

const els = {
  layout: document.querySelector("#profile-layout"),
  search: document.querySelector("#profile-search"),
  feedList: document.querySelector("#profile-feed-list"),
  displayName: document.querySelector("#profile-display-name"),
  avatar: document.querySelector(".profile-avatar-large"),
  recommendButton: document.querySelector("#recommend-button"),
  reportProfileButton: document.querySelector("#profile-report-button"),
  recommendationsButton: document.querySelector("#recommendations-button"),
  recommendationsCount: document.querySelector("#recommendations-count"),
  postsCount: document.querySelector("#posts-count"),
  postsCountLabel: document.querySelector("#posts-count-label"),
  publicInfo: document.querySelector("#profile-public-info"),
  messageLink: document.querySelector("#profile-message-link"),
  peopleModal: document.querySelector("#people-modal"),
  peopleModalTitle: document.querySelector("#people-modal-title"),
  peopleModalClose: document.querySelector("#people-modal-close"),
  peopleList: document.querySelector("#people-list"),
  editProfileLink: document.querySelector("#edit-profile-link"),
  feedSubtitle: document.querySelector("#profile-feed-subtitle"),
  filterButtons: document.querySelectorAll("[data-profile-feed-filter]"),
  listingDetailModal: document.querySelector("#listing-detail-modal"),
  listingDetailContent: document.querySelector("#listing-detail-content"),
};

function redirectLegacySharedPostUrl() {
  const params = new URLSearchParams(window.location.search);
  const postId = params.get("post");
  if (!postId) return false;

  const url = new URL("./post", window.location.origin);
  url.searchParams.set("id", postId);
  window.location.replace(url.toString());
  return true;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getProfileTarget() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id")?.trim();
  const username = (params.get("u") || params.get("username"))?.trim().replace(/^@/, "");

  if (id) return { type: "id", value: id };
  if (username) return { type: "username", value: username };
  return null;
}

function isSystemProfileTarget(target) {
  if (!target) return false;
  if (target.type === "id") return target.value === GIMERR_SYSTEM_PROFILE_ID;
  return GIMERR_SYSTEM_USERNAMES.has(String(target.value || "").toLowerCase());
}

function isSystemProfile(profile) {
  const username = String(profile?.username || "").toLowerCase();
  return profile?.id === GIMERR_SYSTEM_PROFILE_ID || GIMERR_SYSTEM_USERNAMES.has(username);
}

function renderUnavailableSystemProfile() {
  state.profileMissing = true;
  state.loading = false;
  els.layout.classList.remove("is-loading");
  els.displayName.textContent = "Perfil indisponível";
  if (els.avatar) els.avatar.src = "./assets/logo-square-fundo-branco.svg";
  els.publicInfo.innerHTML = `<span class="profile-handle">Este remetente é usado apenas para mensagens oficiais do Gimerr.</span>`;
  els.feedList.innerHTML = `<div class="post-card empty-state">Nada novo por aqui.</div>`;
  els.editProfileLink.hidden = true;
  els.messageLink.hidden = true;
  els.recommendButton.hidden = true;
  els.reportProfileButton.hidden = true;
}

function getPublicProfileUrl(profile) {
  if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
  return `./profile?id=${encodeURIComponent(profile.id)}`;
}

function getProfileUrl(profile) {
  if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
  return `./profile?id=${encodeURIComponent(profile.id || profile.follower_id || profile.recommender_id)}`;
}

function getGameUrl(game) {
  if (!game) return "./game";
  return game.slug
    ? `./game?slug=${encodeURIComponent(game.slug)}`
    : `./game?id=${encodeURIComponent(game.id || game.igdbId || "")}`;
}

function normalizeFollowedProfile(profile) {
  if (!profile?.id || !profile?.username) return null;
  return {
    id: profile.id,
    displayName: profile.display_name || profile.username,
    username: profile.username,
    avatarUrl: profile.avatar_url || "./assets/avatar.svg",
  };
}

function extractMentionUsernames(text, authorUsername = "") {
  const mentions = [];
  const seen = new Set();
  const author = String(authorUsername || "").toLowerCase();
  const pattern = /(^|[\s([{"'“‘])@([a-z0-9_.]{3,24})(?=$|[\s),.!?:;}"'”’\]])/gi;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    const username = match[2].replace(/\.+$/, "");
    const key = username.toLowerCase();
    if (!username || key === author || seen.has(key)) continue;
    seen.add(key);
    mentions.push(username);
  }
  return mentions;
}

function renderMentionLine(authorName, authorUsername, post) {
  const mentions = extractMentionUsernames(post?.body, authorUsername);
  if (!mentions.length) return "";
  const links = mentions.map((username) => (
    `<a href="./profile?u=${encodeURIComponent(username)}">@${escapeHtml(username)}</a>`
  )).join(", ");
  return `<p class="post-mention-line"><strong>${escapeHtml(authorName)}</strong> está com ${links}</p>`;
}

function getPostMediaItems(post) {
  const items = Array.isArray(post.mediaItems) ? post.mediaItems : [];
  if (items.length) return items.filter((item) => item?.url);
  return post.mediaUrl
    ? [{ url: post.mediaUrl, mediaType: post.mediaType }]
    : [];
}

function renderImageLightboxAttrs(post, alt) {
  return [
    "data-image-lightbox",
    `data-image-alt="${escapeHtml(alt)}"`,
    `data-image-author-name="${escapeHtml(profileInfo.displayName || profileInfo.username || "Usuário Gimerr")}"`,
    `data-image-author-username="${escapeHtml(profileInfo.username || "")}"`,
    `data-image-author-avatar="${escapeHtml(profileInfo.avatarUrl || "./assets/avatar.svg")}"`,
    `data-image-body="${escapeHtml(post.body || "")}"`,
    `data-image-post-id="${escapeHtml(post.id || "")}"`,
  ].join(" ");
}

function renderImageGalleryAttrs(items) {
  const payload = items
    .filter((item) => item?.url)
    .slice(0, 15)
    .map((item, index) => ({
      url: item.url,
      alt: `Imagem ${index + 1} do anúncio`,
    }));
  return `data-image-items="${escapeHtml(JSON.stringify(payload))}"`;
}

function renderVideoPoster(post, item) {
  const poster = post.videoThumbnailUrl || "";
  return `
    <div class="video-media" data-video-view-container data-post-id="${escapeHtml(post.id || "")}">
      <button class="video-lazy-button media-frame" type="button" data-video-ads="off" data-video-post-id="${escapeHtml(post.id || "")}" data-video-src="${escapeHtml(item.url)}" data-video-type="${escapeHtml(item.mediaType || "video/mp4")}" ${poster ? `data-video-poster="${escapeHtml(poster)}"` : ""} aria-label="Reproduzir vídeo">
        ${poster ? `<img class="video-lazy-poster" src="${escapeHtml(poster)}" alt="">` : `<span class="video-lazy-empty">Vídeo</span>`}
        <span class="video-lazy-play" aria-hidden="true"></span>
      </button>
    </div>
  `;
}

function renderPostMedia(post) {
  if (post.type === "listing") return renderListingMedia(post);
  const items = getPostMediaItems(post);
  if (!items.length) return "";
  const [firstItem] = items;
  if (firstItem.mediaType?.startsWith("video/")) {
    return renderVideoPoster(post, firstItem);
  }
  if (items.length === 1) {
    return `
      <button class="media-zoom-button" type="button" data-image-src="${escapeHtml(firstItem.url)}" ${renderImageLightboxAttrs(post, "Imagem do post")}>
        <img class="media-frame" src="${escapeHtml(firstItem.url)}" alt="">
      </button>
    `;
  }
  return `
    <button class="media-zoom-button listing-preview-button" type="button" data-image-src="${escapeHtml(firstItem.url)}" data-image-index="0" ${renderImageGalleryAttrs(items)} ${renderImageLightboxAttrs(post, "Imagem do anúncio")}>
      <img src="${escapeHtml(firstItem.url)}" alt="">
      <span class="listing-preview-count">+${items.length - 1}</span>
    </button>
  `;
}

function renderTextWithMentions(text, authorUsername = "") {
  const value = String(text || "");
  const author = String(authorUsername || "").toLowerCase();
  const pattern = /(^|[\s([{"'“‘])@([a-z0-9_.]{3,24})(?=$|[\s),.!?:;}"'”’\]])/gi;
  let output = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(value))) {
    const username = match[2].replace(/\.+$/, "");
    const key = username.toLowerCase();
    const atIndex = match.index + match[1].length;
    output += escapeHtml(value.slice(lastIndex, atIndex));
    if (key && key !== author) {
      output += `<a class="inline-mention" href="./profile?u=${encodeURIComponent(username)}">@${escapeHtml(username)}</a>`;
    } else {
      output += escapeHtml(`@${username}`);
    }
    lastIndex = atIndex + username.length + 1;
  }

  output += escapeHtml(value.slice(lastIndex));
  return output;
}

function getActiveMention(text, cursor) {
  const beforeCursor = String(text || "").slice(0, cursor);
  const match = beforeCursor.match(/(^|[\s([{"'“‘])@([a-z0-9_.]{1,24})$/i);
  if (!match) return null;
  const query = match[2] || "";
  if (!query) return null;
  return {
    start: beforeCursor.length - query.length - 1,
    end: cursor,
    query: query.toLowerCase(),
  };
}

function getMentionMatches(query) {
  if (!query) return [];
  const normalized = query.toLowerCase();
  return state.followedProfiles
    .filter((profile) => {
      const username = String(profile.username || "").toLowerCase();
      const displayName = String(profile.displayName || "").toLowerCase();
      return username.startsWith(normalized) || displayName.startsWith(normalized);
    })
    .slice(0, 6);
}

function closeCommentMentionSuggestions() {
  state.commentMention = {
    active: false,
    start: -1,
    end: -1,
    selectedIndex: 0,
    items: [],
    textarea: null,
  };
  document.querySelectorAll("[data-comment-mention-suggestions]").forEach((container) => {
    container.hidden = true;
    container.innerHTML = "";
  });
}

function renderCommentMentionSuggestions() {
  const textarea = state.commentMention.textarea;
  const container = textarea?.closest("form")?.querySelector("[data-comment-mention-suggestions]");
  if (!container) return;
  if (!state.commentMention.active || !state.commentMention.items.length) {
    closeCommentMentionSuggestions();
    return;
  }

  container.hidden = false;
  container.innerHTML = state.commentMention.items.map((profile, index) => `
    <button class="composer-mention-option${index === state.commentMention.selectedIndex ? " is-active" : ""}" type="button" data-comment-mention-index="${index}">
      <span class="user-search-avatar">
        <img src="${escapeHtml(profile.avatarUrl || "./assets/avatar.svg")}" alt="">
      </span>
      <span class="composer-mention-copy">
        <strong>${escapeHtml(profile.displayName)}</strong>
        <span>@${escapeHtml(profile.username)}</span>
      </span>
    </button>
  `).join("");
}

function updateCommentMentionSuggestions(textarea) {
  const activeMention = getActiveMention(textarea.value, textarea.selectionStart);
  if (!activeMention) {
    closeCommentMentionSuggestions();
    return;
  }

  const items = getMentionMatches(activeMention.query);
  if (!items.length) {
    closeCommentMentionSuggestions();
    return;
  }

  state.commentMention = {
    active: true,
    start: activeMention.start,
    end: activeMention.end,
    selectedIndex: Math.min(state.commentMention.selectedIndex || 0, items.length - 1),
    items,
    textarea,
  };
  renderCommentMentionSuggestions();
}

function insertCommentMention(profile) {
  const textarea = state.commentMention.textarea;
  if (!textarea || !profile || !state.commentMention.active) return;
  const text = textarea.value;
  const before = text.slice(0, state.commentMention.start);
  const after = text.slice(state.commentMention.end);
  const nextValue = `${before}@${profile.username} ${after}`;
  const nextCursor = before.length + profile.username.length + 2;
  textarea.value = nextValue.slice(0, Number(textarea.maxLength || 500));
  closeCommentMentionSuggestions();
  textarea.focus();
  textarea.setSelectionRange(nextCursor, nextCursor);
}

function isPhoneContactSchemaError(error) {
  return /phone_contact_(whatsapp|telegram)/i.test(error?.message || "");
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "agora";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} d`;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function applyProfile(profile, links = []) {
  if (!profile) return;

  state.profileMissing = false;
  const displayName = profile.display_name || profile.username || "Usuário Gimerr";
  profileInfo.id = profile.id;
  profileInfo.displayName = displayName;
  profileInfo.username = profile.username || "";
  profileInfo.avatarUrl = profile.avatar_url || "";
  profileInfo.phone = profile.phone_e164 || "";
  profileInfo.phoneVisibility = profile.phone_e164 ? "public" : "private";
  profileInfo.phoneContactWhatsapp = Boolean(profile.phone_contact_whatsapp);
  profileInfo.phoneContactTelegram = Boolean(profile.phone_contact_telegram);
  profileInfo.connectedAccounts = links.map((link) => ({
    platform: link.platform,
    handle: link.handle || link.platform,
    profileUrl: link.profile_url,
    externalUserId: link.external_user_id,
  }));

  document.title = `${displayName} | Gimerr`;
  els.displayName.textContent = displayName;

  if (profile.avatar_url) {
    els.avatar.innerHTML = `<img src="${escapeHtml(profile.avatar_url)}" alt="">`;
  } else {
    els.avatar.innerHTML = `<img src="./assets/avatar.svg" alt="">`;
  }

  els.feedSubtitle.textContent = `Conteúdo publicado por ${displayName}.`;
}

async function loadProfileStats(client, profileId, viewerId) {
  const [
    statsResult,
    recommendationsResult,
    recommendedResult,
  ] = await Promise.all([
    client
      .from("public_profile_stats")
      .select("recommendations_count, posts_count")
      .eq("profile_id", profileId)
      .maybeSingle(),
    client
      .from("public_profile_recommenders")
      .select("recommender_id, display_name, username, avatar_url")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(50),
    viewerId && viewerId !== profileId
      ? client
        .from("profile_recommendations")
        .select("recommender_id")
        .eq("recommender_id", viewerId)
        .eq("recommended_id", profileId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (statsResult.error) throw statsResult.error;
  if (recommendationsResult.error) throw recommendationsResult.error;
  if (recommendedResult.error && recommendedResult.error.code !== "PGRST116") throw recommendedResult.error;

  state.recommendationCount = Number(statsResult.data?.recommendations_count || 0);
  state.recommendations = recommendationsResult.data || [];
  state.recommended = Boolean(recommendedResult.data);
}

async function loadProfilePosts(client, profileId) {
  const { data, error, count } = await client
    .from("public_feed_posts")
    .select("id, profile_id, game_igdb_id, post_type, body, media_url, media_type, media_items, video_status, video_thumbnail_url, processing_error, comment_count, video_view_count, listing_view_count, created_at, game_name, game_slug, game_cover_url", { count: "exact" })
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  state.posts = (data || []).map((post) => ({
    id: post.id,
    profileId: post.profile_id,
    type: post.post_type,
    body: post.body || "",
    mediaUrl: post.media_url || "",
    mediaType: post.media_type || "",
    mediaItems: Array.isArray(post.media_items) ? post.media_items : [],
    videoStatus: post.video_status || "none",
    videoThumbnailUrl: post.video_thumbnail_url || "",
    processingError: post.processing_error || "",
    commentCount: Number(post.comment_count || 0),
    videoViewCount: Number(post.video_view_count || 0),
    listingViewCount: Number(post.listing_view_count || 0),
    createdAt: post.created_at,
    gameId: post.game_igdb_id,
    gameName: post.game_name || "Game",
    gameSlug: post.game_slug || "",
    gameCoverUrl: post.game_cover_url || "",
  }));
  state.postsCount = Number(count ?? state.posts.length);
}

async function loadRecommendedProfiles(client, viewerId) {
  if (!viewerId) {
    state.followedProfiles = [];
    return;
  }

  const { data: recommendations, error: recommendationsError } = await client
    .from("profile_recommendations")
    .select("recommended_id")
    .eq("recommender_id", viewerId)
    .order("created_at", { ascending: false })
    .limit(80);

  if (recommendationsError) throw recommendationsError;

  const recommendedIds = [...new Set((recommendations || [])
    .map((row) => row.recommended_id)
    .filter(Boolean))];

  if (!recommendedIds.length) {
    state.followedProfiles = [];
    return;
  }

  const { data: profiles, error: profilesError } = await client
    .from("public_profiles")
    .select("id, display_name, username, avatar_url")
    .in("id", recommendedIds);

  if (profilesError) throw profilesError;

  const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
  state.followedProfiles = recommendedIds
    .map((id) => normalizeFollowedProfile(byId.get(id)))
    .filter(Boolean);
}

async function hydrateAuthenticatedProfile() {
  try {
    const client = await window.GimerrAuth.getClient();
    const { data } = await window.GimerrAuth.getSession();
    const user = data.session?.user;
    const target = getProfileTarget();
    state.session = data.session || null;

    if (isSystemProfileTarget(target)) {
      renderUnavailableSystemProfile();
      return;
    }

    if (!target && !user) {
      window.location.replace("./sign-in.html");
      return;
    }

    let query = client
      .from("public_profiles")
      .select("id, display_name, username, phone_e164, phone_contact_whatsapp, phone_contact_telegram, avatar_url");

    if (target?.type === "username") {
      query = query.eq("username", target.value);
    } else {
      query = query.eq("id", target?.value || user.id);
    }

    let profileResult = await query.maybeSingle();

    if (isPhoneContactSchemaError(profileResult.error)) {
      let fallbackQuery = client
        .from("public_profiles")
        .select("id, display_name, username, phone_e164, avatar_url");

      if (target?.type === "username") {
        fallbackQuery = fallbackQuery.eq("username", target.value);
      } else {
        fallbackQuery = fallbackQuery.eq("id", target?.value || user.id);
      }

      profileResult = await fallbackQuery.maybeSingle();
    }

    if (profileResult.error) throw profileResult.error;

    if (!profileResult.data) {
      state.profileMissing = true;
      state.loading = false;
      els.layout.classList.remove("is-loading");
      els.displayName.textContent = "Perfil não encontrado";
      els.publicInfo.innerHTML = `<span class="profile-handle">Este usuário ainda não existe no Gimerr.</span>`;
      els.feedList.innerHTML = `<div class="post-card empty-state">Nada novo por aqui.</div>`;
      els.editProfileLink.hidden = true;
      els.messageLink.hidden = true;
      els.recommendButton.hidden = true;
      els.reportProfileButton.hidden = true;
      return;
    }

    if (isSystemProfile(profileResult.data)) {
      renderUnavailableSystemProfile();
      return;
    }

    const { data: links, error: linksError } = await client
      .from("public_profile_platform_links")
      .select("platform, handle, profile_url, external_user_id")
      .eq("profile_id", profileResult.data.id);

    if (linksError) throw linksError;

    await Promise.all([
      loadProfileStats(client, profileResult.data.id, user?.id),
      loadProfilePosts(client, profileResult.data.id),
      loadRecommendedProfiles(client, user?.id),
    ]);
    applyProfile(profileResult.data, links || []);

    const isOwnProfile = profileResult.data.id === user?.id;
    els.editProfileLink.hidden = !isOwnProfile;
    els.messageLink.hidden = isOwnProfile;
    els.recommendButton.hidden = isOwnProfile;
    els.reportProfileButton.hidden = isOwnProfile;

    if (isOwnProfile) {
      window.history.replaceState({}, document.title, getPublicProfileUrl(profileResult.data));
    }
  } catch (error) {
    console.warn("Não foi possível carregar perfil.", error);
    state.loading = false;
    els.layout.classList.remove("is-loading");
    els.displayName.textContent = "Não foi possível carregar o perfil";
    els.feedList.innerHTML = `<div class="post-card empty-state">Tente novamente em instantes.</div>`;
  }
}

function renderCounts() {
  if (state.loading) return;
  els.recommendationsCount.textContent = String(state.recommendationCount);
  els.postsCount.textContent = String(state.postsCount);
  if (els.postsCountLabel) {
    els.postsCountLabel.textContent = Number(state.postsCount || 0) === 1 ? "publicação" : "publicações";
  }
}

function setRecommendButtonLabel(label) {
  if (!els.recommendButton) return;
  els.recommendButton.innerHTML = `
    <img src="./assets/rec.svg" alt="" aria-hidden="true">
    <span>${escapeHtml(label)}</span>
  `;
}

function renderActions() {
  if (state.loading) return;
  if (state.profileMissing) return;
  const isOwnProfile = state.session?.user?.id === profileInfo.id;
  els.messageLink.hidden = isOwnProfile || !profileInfo.id;
  els.messageLink.href = profileInfo.id
    ? `./messages?recipientId=${encodeURIComponent(profileInfo.id)}`
    : "./messages.html";
  els.recommendButton.disabled = !state.session?.user || !profileInfo.id;
  els.reportProfileButton.hidden = isOwnProfile || !profileInfo.id;
  els.reportProfileButton.disabled = !state.session?.user || !profileInfo.id;
  setRecommendButtonLabel(state.recommended ? "Recomendado" : "Recomendar");
  els.recommendButton.classList.toggle("is-secondary-state", state.recommended);
}

function renderPublicInfo() {
  if (state.loading) return;
  if (state.profileMissing) return;
  const phoneDigits = profileInfo.phone.replace(/\D/g, "");
  const getPlatformMeta = (platform) => {
    const id = String(platform || "").toLowerCase();
    if (id === "discord") return { id, label: "Discord", icon: "./assets/discord.svg" };
    if (id === "twitch") return { id, label: "Twitch", icon: "./assets/twitch.svg" };
    return { id, label: platform || "Plataforma", icon: "" };
  };
  const phoneItem = profileInfo.phoneVisibility === "public" && profileInfo.phone
    ? `<a class="info-pill" href="tel:${escapeHtml(profileInfo.phone.replace(/\s/g, ""))}">${escapeHtml(profileInfo.phone)}</a>`
    : "";
  const whatsappItem = profileInfo.phoneVisibility === "public" && profileInfo.phoneContactWhatsapp && phoneDigits
    ? `<a class="info-pill contact-pill whatsapp-contact-pill" href="https://wa.me/${escapeHtml(phoneDigits)}" target="_blank" rel="noopener">
        <img src="./assets/whatsapp.svg" alt="">
        WhatsApp
      </a>`
    : "";
  const telegramItem = profileInfo.phoneVisibility === "public" && profileInfo.phoneContactTelegram && phoneDigits
    ? `<a class="info-pill contact-pill telegram-contact-button" href="tg://resolve?phone=${escapeHtml(phoneDigits)}">
        <img src="./assets/telegram.svg" alt="">
        Telegram
      </a>`
    : "";

  const accountItems = profileInfo.connectedAccounts.map((account) => {
    const platform = String(account.platform || "");
    const lowerPlatform = platform.toLowerCase();
    const platformMeta = getPlatformMeta(platform);
    const handle = account.handle?.startsWith("@") ? account.handle : `@${account.handle || platform}`;
    const profileUrl = lowerPlatform === "discord" && account.externalUserId
      ? `discord://-/users/${account.externalUserId}`
      : account.profileUrl;
    const tag = profileUrl ? "a" : "span";
    const attrs = profileUrl
      ? `href="${escapeHtml(profileUrl)}" ${lowerPlatform === "discord" ? "" : 'target="_blank" rel="noopener"'}`
      : "";

    return `
      <${tag} class="info-pill platform-pill platform-pill-${escapeHtml(platformMeta.id)}" ${attrs} aria-label="${escapeHtml(`${platformMeta.label}: ${handle}`)}" title="${escapeHtml(`${platformMeta.label}: ${handle}`)}">
        ${platformMeta.icon ? `<img src="${escapeHtml(platformMeta.icon)}" alt="" aria-hidden="true">` : `<strong>${escapeHtml(platformMeta.label.slice(0, 2).toUpperCase())}</strong>`}
        <span>${escapeHtml(handle)}</span>
      </${tag}>
    `;
  }).join("");

  els.publicInfo.innerHTML = `
    ${profileInfo.username ? `<span class="profile-handle">@${escapeHtml(profileInfo.username)}</span>` : ""}
    <div class="profile-info-list">
      ${phoneItem}
      ${whatsappItem}
      ${telegramItem}
      ${accountItems}
    </div>
  `;
}

function renderPostMenu(post) {
  const postId = escapeHtml(post.id);
  const ownerId = post.author?.id || post.profileId || post.profile_id || "";
  const isOwner = state.session?.user?.id && String(ownerId) === String(state.session.user.id);
  const isListing = post.type === "listing";
  return `
    <div class="post-menu" data-post-menu>
      <button class="ghost-icon post-menu-button" type="button" data-post-menu-toggle data-post-id="${postId}" aria-label="Abrir menu do post" aria-expanded="false">
        <span aria-hidden="true">&#8942;</span>
      </button>
      <div class="post-menu-popover" hidden>
        ${!isOwner ? `<button type="button" data-post-report data-post-id="${postId}">Denunciar</button>` : ""}
        ${isOwner && isListing ? `<a href="./?editListing=${encodeURIComponent(post.id)}">Editar</a>` : ""}
        ${isOwner && !isListing ? `<button type="button" data-post-edit data-post-id="${postId}">Editar</button>` : ""}
        ${isOwner ? `<button class="danger" type="button" data-post-delete data-post-id="${postId}">Excluir</button>` : ""}
      </div>
    </div>
  `;
}

function closePostMenus(exceptMenu = null) {
  document.querySelectorAll("[data-post-menu]").forEach((menu) => {
    if (exceptMenu && menu === exceptMenu) return;
    const popover = menu.querySelector(".post-menu-popover");
    const toggle = menu.querySelector("[data-post-menu-toggle]");
    if (popover) popover.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  });
}

function togglePostMenu(button) {
  const menu = button.closest("[data-post-menu]");
  const popover = menu?.querySelector(".post-menu-popover");
  if (!menu || !popover) return;
  const willOpen = popover.hidden;
  closePostMenus(menu);
  popover.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}

function getPostShareUrl(postId) {
  const url = new URL("./post", window.location.origin);
  url.searchParams.set("id", postId);
  return url.toString();
}

async function copyTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

async function sharePost(postId) {
  const url = getPostShareUrl(postId);
  const post = state.posts.find((item) => String(item.id) === String(postId));
  const title = post?.type === "video"
    ? `Veja este vídeo no Gimerr`
    : post?.type === "listing"
      ? `Veja este anúncio no Gimerr`
    : `Veja este post no Gimerr`;

  if (window.GimerrShare?.openPostShare) {
    await window.GimerrShare.openPostShare({
      postId,
      post,
      title,
      text: `Publicado em ${post?.gameName || "Gimerr"}`,
      url,
    });
    return;
  }

  await copyTextToClipboard(url);
  window.alert("Link copiado.");
}

function formatCommentCount(value) {
  const count = Number(value || 0);
  if (count === 0) return "0 comentários";
  if (count === 1) return "1 comentário";
  return `${new Intl.NumberFormat("pt-BR").format(count)} comentários`;
}

function formatVideoViewCount(value) {
  const count = Number(value || 0);
  const formatted = new Intl.NumberFormat("pt-BR").format(count);
  return count === 1 ? "1 visualização" : `${formatted} visualizações`;
}

function hasVideoMedia(post) {
  return getPostMediaItems(post).some((item) => String(item?.mediaType || "").startsWith("video/"));
}

function renderProfilePostTools(post) {
  if (post.type === "listing") return "";
  const label = hasVideoMedia(post)
    ? `<span class="video-view-counter is-inline" data-video-view-count data-post-id="${escapeHtml(post.id || "")}">${escapeHtml(formatVideoViewCount(post.videoViewCount))}</span>`
    : `<span class="profile-post-time">Publicação</span>`;
  return `
    <div class="profile-post-tools-row">
      ${label}
      ${renderPostMenu(post)}
    </div>
  `;
}

function renderPostTextBlock(post, textHtml) {
  if (post.type === "listing") {
    return textHtml ? `<p class="post-text">${textHtml}</p>` : "";
  }
  const postId = String(post?.id || "");
  const isEditing = state.editingPostId === postId;
  const isSubmitting = state.editSubmittingPostId === postId;
  if (!isEditing) return textHtml ? `<p class="post-text">${textHtml}</p>` : "";
  return `
    <form class="post-edit-form" data-post-edit-form data-post-id="${escapeHtml(postId)}">
      <textarea class="post-edit-textarea" name="body" maxlength="1200" rows="4">${escapeHtml(post.body || "")}</textarea>
      <div class="post-edit-actions">
        <button class="primary-button" type="submit" ${isSubmitting ? "disabled" : ""}>${isSubmitting ? "Salvando..." : "Salvar"}</button>
        <button class="text-button" type="button" data-post-edit-cancel data-post-id="${escapeHtml(postId)}" ${isSubmitting ? "disabled" : ""}>Cancelar</button>
      </div>
    </form>
  `;
}

function formatListingItemCount(count) {
  const value = Number(count || 0);
  if (value === 1) return "1 item";
  return `${new Intl.NumberFormat("pt-BR").format(value)} itens`;
}

function formatListingViewCount(value) {
  const count = Number(value || 0);
  if (count >= 1000) return `${new Intl.NumberFormat("pt-BR").format(Math.floor(count / 1000))}k`;
  return new Intl.NumberFormat("pt-BR").format(count);
}

function formatListingViewBadge(value) {
  const count = Number(value || 0);
  return `${formatListingViewCount(count)} ${count === 1 ? "visualização" : "visualizações"}`;
}

function formatListingRelativeTime(value) {
  const formatted = formatRelativeTime(value);
  return formatted === "agora" ? "Agora" : formatted;
}

function parseListingBody(body, mediaItems = []) {
  const text = String(body || "");
  const marker = "\n\nItens:\n";
  const markerIndex = text.indexOf(marker);
  const description = markerIndex >= 0 ? text.slice(0, markerIndex) : "";
  const itemsText = markerIndex >= 0 ? text.slice(markerIndex + marker.length) : text.replace(/^Itens:\n/i, "");
  const lines = itemsText.split("\n").map((line) => line.trim()).filter(Boolean);
  const imageItems = mediaItems.filter((item) => String(item?.mediaType || "").startsWith("image/"));
  const mediaByPosition = new Map(imageItems
    .filter((item) => Number.isInteger(Number(item?.position)))
    .map((item) => [Number(item.position), item]));
  const mediaByName = new Map(imageItems
    .filter((item) => item?.itemName)
    .map((item) => [String(item.itemName).toLowerCase(), item]));
  const items = lines.map((line, index) => {
    const [namePart, ...priceParts] = line.split(/\s+-\s+/);
    const mediaItem = mediaByPosition.get(index) || mediaByName.get(String(namePart || "").toLowerCase()) || null;
    return {
      name: namePart || mediaItem?.itemName || "",
      priceLabel: priceParts.join(" - ") || mediaItem?.priceLabel || "",
      previewUrl: mediaItem?.url || "",
      mediaItem,
    };
  });
  return { description, items };
}

function getListingCardData(post) {
  const mediaItems = Array.isArray(post?.mediaItems) ? post.mediaItems : getPostMediaItems(post);
  const parsed = parseListingBody(post?.body || "", mediaItems);
  return {
    ...parsed,
    itemCount: parsed.items.filter((item) => item.name || item.priceLabel || item.previewUrl || item.mediaItem).length,
  };
}

function getListingPreviewText(listingData) {
  const text = listingData?.description || listingData?.items?.find((item) => item.name)?.name || "";
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > 58 ? `${clean.slice(0, 58).trim()}...` : clean;
}

function renderListingMedia(post) {
  const items = getPostMediaItems(post);
  const firstImage = items.find((item) => String(item?.mediaType || "").startsWith("image/"));
  const itemCount = getListingCardData(post).itemCount;
  const countLabel = formatListingItemCount(itemCount);
  const postId = escapeHtml(post.id || "");
  const openAttrs = `type="button" data-listing-open data-post-id="${postId}" aria-label="Ver anúncio"`;
  const overlays = `
    <span class="listing-preview-views" data-listing-view-count data-post-id="${postId}">${escapeHtml(formatListingViewBadge(post.listingViewCount))}</span>
    <button class="listing-preview-share" type="button" data-post-share data-post-id="${postId}" aria-label="Compartilhar anúncio">
      <img src="./assets/share-2.svg" alt="" aria-hidden="true">
    </button>
  `;
  if (!firstImage?.url) {
    return `
      <div class="listing-preview-frame">
        <button class="listing-preview-button listing-placeholder-card" ${openAttrs}>
          <span class="listing-placeholder-title">Sem imagens</span>
          <span class="listing-preview-count">${escapeHtml(countLabel)}</span>
        </button>
        ${overlays}
      </div>
    `;
  }
  return `
    <div class="listing-preview-frame">
      <button class="listing-preview-button" ${openAttrs}>
        <img src="${escapeHtml(firstImage.url)}" alt="">
        <span class="listing-preview-count">${escapeHtml(countLabel)}</span>
      </button>
      ${overlays}
    </div>
  `;
}

function renderPostActions(post) {
  const postId = escapeHtml(post.id);
  if (post.type === "listing") {
    return `
      <div class="post-action-bar post-action-bar--listing listing-card-meta">
        <span>${escapeHtml(formatListingRelativeTime(post.createdAt))}</span>
        ${renderPostMenu(post)}
      </div>
    `;
  }
  return `
    <div class="post-action-bar">
      <div class="post-comment-action">
        <button class="post-action-button" type="button" data-post-comment-toggle data-post-id="${postId}">
          Comentar
        </button>
        <button class="post-comment-count" type="button" data-post-comments-toggle data-post-id="${postId}">
          ${escapeHtml(formatCommentCount(post.commentCount))}
        </button>
      </div>
      <button class="post-action-button" type="button" data-post-share data-post-id="${postId}">
        Compartilhar
      </button>
    </div>
    ${renderInlineCommentsPanel(post)}
    ${renderInlineCommentForm(post)}
  `;
}

function formatCountLabel(value, singular, plural) {
  const count = Number(value || 0);
  const formatted = new Intl.NumberFormat("pt-BR").format(count);
  return count === 1 ? `1 ${singular}` : `${formatted} ${plural}`;
}

function getWhatsappUrl(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : "";
}

function getPhoneLabel(phone) {
  return String(phone || "").replace(/^\+/, "+");
}

function getPlatformMeta(platform) {
  const id = String(platform || "").trim().toLowerCase();
  if (id === "discord") return { id, label: "Discord", icon: "./assets/discord.svg" };
  if (id === "twitch") return { id, label: "Twitch", icon: "./assets/twitch.svg" };
  return { id: id || "platform", label: platform || "Plataforma", icon: "" };
}

function renderSellerContacts(details) {
  const profile = details?.profile || {};
  const links = Array.isArray(details?.platformLinks) ? details.platformLinks : [];
  const contactItems = [];
  if (profile.phone_e164) {
    contactItems.push(`<a href="tel:${escapeHtml(profile.phone_e164)}">Telefone: ${escapeHtml(getPhoneLabel(profile.phone_e164))}</a>`);
    if (profile.phone_contact_whatsapp) {
      const whatsappUrl = getWhatsappUrl(profile.phone_e164);
      if (whatsappUrl) {
        contactItems.push(`
          <a class="info-pill contact-pill whatsapp-contact-pill" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener">
            <img src="./assets/whatsapp.svg" alt="">
            WhatsApp
          </a>
        `);
      }
    }
    if (profile.phone_contact_telegram) {
      const phoneDigits = String(profile.phone_e164 || "").replace(/\D/g, "");
      if (phoneDigits) {
        contactItems.push(`
          <a class="info-pill contact-pill telegram-contact-button" href="tg://resolve?phone=${escapeHtml(phoneDigits)}">
            <img src="./assets/telegram.svg" alt="">
            Telegram
          </a>
        `);
      }
    }
  }
  links.forEach((link) => {
    const platformMeta = getPlatformMeta(link.platform);
    const handle = link.handle || platformMeta.label;
    const label = `${platformMeta.label}${link.handle ? `: ${link.handle}` : ""}`;
    if (link.profile_url) {
      contactItems.push(`
        <a class="info-pill platform-pill platform-pill-${escapeHtml(platformMeta.id)}" href="${escapeHtml(link.profile_url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
          ${platformMeta.icon ? `<img src="${escapeHtml(platformMeta.icon)}" alt="">` : ""}
          <span>${escapeHtml(handle)}</span>
        </a>
      `);
    } else {
      contactItems.push(`
        <span class="info-pill platform-pill platform-pill-${escapeHtml(platformMeta.id)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
          ${platformMeta.icon ? `<img src="${escapeHtml(platformMeta.icon)}" alt="">` : ""}
          <span>${escapeHtml(handle)}</span>
        </span>
      `);
    }
  });
  return contactItems.length
    ? contactItems.map((item) => `<li>${item}</li>`).join("")
    : `<li><span>Sem contatos públicos.</span></li>`;
}

function getListingGame(post) {
  return post?.game || {
    id: post?.gameId || "",
    slug: post?.gameSlug || "",
    name: post?.gameName || "Game",
    coverUrl: post?.gameCoverUrl || "./assets/avatar.svg",
  };
}

function getListingAuthor(post) {
  return {
    id: profileInfo.id,
    displayName: profileInfo.displayName,
    username: profileInfo.username,
    avatarUrl: profileInfo.avatarUrl || "./assets/avatar.svg",
    ...(post?.author || {}),
  };
}

function renderListingDetail(post, sellerDetails = null) {
  const listingData = getListingCardData(post);
  const game = getListingGame(post);
  const author = getListingAuthor(post);
  const sellerProfile = sellerDetails?.profile || {};
  const stats = sellerDetails?.stats || {};
  const sellerName = sellerProfile.display_name || author.displayName || author.username || "Vendedor Gimerr";
  const sellerUsername = sellerProfile.username || author.username || "";
  const sellerAvatar = sellerProfile.avatar_url || author.avatarUrl || "./assets/avatar.svg";
  const canMessageSeller = author.id && author.id !== state.session?.user?.id;
  const mediaItems = getPostMediaItems(post);
  const listingVideo = mediaItems.find((item) => String(item?.mediaType || "").startsWith("video/"));
  const items = listingData.items.filter((item) => item.name || item.price || item.priceLabel || item.mediaItem || item.previewUrl);
  const galleryItems = items
    .filter((item) => item.previewUrl)
    .map((item, index) => ({
      url: item.previewUrl,
      alt: item.name ? `Imagem do item ${item.name}` : `Imagem do item ${index + 1}`,
    }));
  const itemList = items.map((item) => {
    const galleryIndex = item.previewUrl
      ? galleryItems.findIndex((galleryItem) => galleryItem.url === item.previewUrl)
      : -1;
    const imageAlt = item.name ? `Imagem do item ${item.name}` : "Imagem do item";
    return `
      <article class="listing-detail-item">
        ${item.previewUrl ? `
          <button class="listing-detail-item-media" type="button" data-image-src="${escapeHtml(item.previewUrl)}" data-image-index="${Math.max(0, galleryIndex)}" data-image-items="${escapeHtml(JSON.stringify(galleryItems))}" ${renderImageLightboxAttrs(post, imageAlt)} aria-label="Ampliar imagem do item">
            <img src="${escapeHtml(item.previewUrl)}" alt="">
          </button>
        ` : `
          <div class="listing-detail-item-media">
            <span>Sem imagem</span>
          </div>
        `}
        <div>
          <strong>${escapeHtml(item.name || "Item")}</strong>
          ${item.priceLabel ? `<span>${escapeHtml(item.priceLabel)}</span>` : ""}
        </div>
      </article>
    `;
  }).join("");

  return `
    <div class="listing-detail-grid">
      <div class="listing-detail-actions">
        <button class="ghost-icon listing-detail-close" type="button" data-listing-close aria-label="Voltar">x</button>
        <button class="post-action-button" type="button" data-post-share data-post-id="${escapeHtml(post.id)}">Compartilhar</button>
        ${renderPostMenu(post)}
      </div>
      <section class="listing-detail-main">
        <div>
          <a class="channel-line" href="${getGameUrl(game)}">
            <span class="channel-game-logo" aria-hidden="true">
              <img src="${escapeHtml(game?.coverUrl || "./assets/avatar.svg")}" alt="">
            </span>
            <span>Em ${escapeHtml(game?.name || "Game")} ${escapeHtml(formatRelativeTime(post.createdAt))}</span>
          </a>
          <h2 id="listing-detail-title">${escapeHtml(formatListingItemCount(listingData.itemCount))}</h2>
          ${listingData.description ? `<p class="listing-detail-description">${escapeHtml(listingData.description)}</p>` : ""}
        </div>
        ${listingVideo ? renderVideoPoster(post, listingVideo) : ""}
        <div class="listing-detail-items">
          ${itemList || `<p class="empty-state">Nenhum item informado.</p>`}
        </div>
      </section>
      <aside class="listing-detail-seller">
        <a class="listing-seller-head" href="${getProfileUrl({ id: author.id, username: sellerUsername })}">
          <img src="${escapeHtml(sellerAvatar)}" alt="">
          <span>
            <strong>${escapeHtml(sellerName)}</strong>
            ${sellerUsername ? `<small>@${escapeHtml(sellerUsername)}</small>` : ""}
          </span>
        </a>
        <div class="listing-seller-stats">
          <span>${escapeHtml(formatCountLabel(stats.recommendations_count, "recomendação", "recomendações"))}</span>
        </div>
        ${canMessageSeller ? `
          <a class="primary-button listing-message-button message-action-button" href="./messages?listingPostId=${encodeURIComponent(post.id)}">
            <img src="./assets/message.svg" alt="" aria-hidden="true">
            <span>Enviar mensagem</span>
          </a>
        ` : ""}
        <div class="listing-seller-contact">
          <strong>Contato</strong>
          <ul>${renderSellerContacts(sellerDetails)}</ul>
        </div>
      </aside>
    </div>
  `;
}

async function loadListingSellerDetails(authorId) {
  if (!authorId) return null;
  if (state.listingSellerCache.has(authorId)) return state.listingSellerCache.get(authorId);
  const client = await window.GimerrAuth.getClient();
  const [profileResult, statsResult, linksResult] = await Promise.all([
    client
      .from("public_profiles")
      .select("id, display_name, username, avatar_url, phone_e164, phone_contact_whatsapp, phone_contact_telegram")
      .eq("id", authorId)
      .maybeSingle(),
    client
      .from("public_profile_stats")
      .select("profile_id, recommendations_count")
      .eq("profile_id", authorId)
      .maybeSingle(),
    client
      .from("public_profile_platform_links")
      .select("platform, handle, profile_url")
      .eq("profile_id", authorId),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (statsResult.error) throw statsResult.error;
  if (linksResult.error) throw linksResult.error;
  const details = {
    profile: profileResult.data || {},
    stats: statsResult.data || {},
    platformLinks: linksResult.data || [],
  };
  state.listingSellerCache.set(authorId, details);
  return details;
}

async function loadListingDetailPost(postId) {
  const response = await fetch(`/api/posts/detail?id=${encodeURIComponent(postId)}`, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o anúncio.");
  return payload.post || null;
}

function mergeListingDetailPost(fallbackPost, detailPost) {
  if (!detailPost) return fallbackPost;
  const index = state.posts.findIndex((item) => String(item.id) === String(detailPost.id));
  if (index >= 0) {
    state.posts[index] = {
      ...state.posts[index],
      ...detailPost,
      author: {
        ...(getListingAuthor(state.posts[index]) || {}),
        ...(detailPost.author || {}),
      },
      game: {
        ...(getListingGame(state.posts[index]) || {}),
        ...(detailPost.game || {}),
      },
    };
    return state.posts[index];
  }
  return {
    ...fallbackPost,
    ...detailPost,
    author: {
      ...(fallbackPost ? getListingAuthor(fallbackPost) : {}),
      ...(detailPost.author || {}),
    },
    game: {
      ...(fallbackPost ? getListingGame(fallbackPost) : {}),
      ...(detailPost.game || {}),
    },
  };
}

async function recordListingView(postId) {
  if (!postId || !state.session?.access_token) return;
  try {
    const response = await fetch("/api/posts/listing-view", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${state.session.access_token}`,
      },
      body: JSON.stringify({ postId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível registrar visualização.");
    const listingViewCount = Number(payload.listingViewCount || 0);
    state.posts = state.posts.map((post) => (
      String(post.id) === String(postId)
        ? { ...post, listingViewCount }
        : post
    ));
    document.querySelectorAll("[data-listing-view-count]").forEach((element) => {
      if (String(element.dataset.postId || "") === String(postId)) {
        element.textContent = formatListingViewBadge(listingViewCount);
      }
    });
  } catch (error) {
    console.warn("Não foi possível registrar visualização do anúncio.", error);
  }
}

function closeListingDetailModal() {
  if (!els.listingDetailModal) return;
  window.GimerrVideoPlayer?.stopAll?.(els.listingDetailContent);
  els.listingDetailModal.hidden = true;
  if (els.listingDetailContent) els.listingDetailContent.innerHTML = "";
}

async function openListingDetail(postId) {
  const feedPost = state.posts.find((item) => String(item.id) === String(postId));
  if (!els.listingDetailModal || !els.listingDetailContent) return;
  if (feedPost && feedPost.type !== "listing") return;
  els.listingDetailModal.hidden = false;
  els.listingDetailContent.innerHTML = `<div class="listing-detail-loading">Carregando anúncio...</div>`;
  try {
    let post = feedPost;
    if (!post) {
      const detailPost = await loadListingDetailPost(postId);
      if (!detailPost || detailPost.type !== "listing") throw new Error("Anúncio não encontrado.");
      post = mergeListingDetailPost(feedPost, detailPost);
    }
    recordListingView(postId);
    els.listingDetailContent.innerHTML = renderListingDetail(post, null);
    window.GimerrVideoPlayer?.prepare?.(els.listingDetailContent);
    const sellerDetails = await loadListingSellerDetails(getListingAuthor(post).id);
    els.listingDetailContent.innerHTML = renderListingDetail(post, sellerDetails);
    window.GimerrVideoPlayer?.prepare?.(els.listingDetailContent);
  } catch (error) {
    console.warn("Não foi possível carregar detalhes do anúncio.", error);
    if (feedPost?.type === "listing") {
      recordListingView(postId);
      els.listingDetailContent.innerHTML = renderListingDetail(feedPost, null);
      window.GimerrVideoPlayer?.prepare?.(els.listingDetailContent);
      return;
    }
    els.listingDetailContent.innerHTML = `<div class="listing-detail-loading">Não foi possível carregar este anúncio.</div>`;
  }
}

function groupCommentsByParent(comments) {
  return (comments || []).reduce((groups, comment) => {
    const key = comment.parentCommentId || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(comment);
    return groups;
  }, new Map());
}

function getReplyMention(comment) {
  const username = comment?.author?.username ? `@${comment.author.username} ` : "";
  return escapeHtml(username);
}

function buildCommentsById(comments) {
  return new Map((comments || []).map((comment) => [String(comment.id), comment]));
}

function renderCommentReplyReference(comment, commentsById) {
  const parentId = comment.parentCommentId || "";
  if (!parentId) return "";
  const localParent = commentsById?.get(String(parentId));
  const parent = localParent ? {
    id: localParent.id,
    status: "active",
    author: localParent.author,
  } : comment.parent;
  if (!parent || parent.status !== "active") {
    return `<span class="comment-reply-reference is-deleted">Em resposta a comentário excluído</span>`;
  }
  const parentAuthor = parent.author || {};
  const label = parentAuthor.displayName || parentAuthor.username || "comentário";
  return `<a class="comment-reply-reference" href="#comment-${escapeHtml(parentId)}">Em resposta a ${escapeHtml(label)}</a>`;
}

function renderInlineCommentReplyForm(postId, comment) {
  if (String(state.replyingToCommentId) !== String(comment.id)) return "";
  if (!state.session?.access_token) {
    return `<a class="text-button inline-comment-login" href="./sign-in.html">Entre para responder</a>`;
  }
  const isSubmitting = String(state.commentSubmittingPostId) === String(comment.id);
  return `
    <form class="inline-comment-form inline-reply-form" data-inline-comment-form data-post-id="${escapeHtml(postId)}" data-parent-comment-id="${escapeHtml(comment.id)}">
      <textarea maxlength="500" rows="2" placeholder="Responder comentário">${getReplyMention(comment)}</textarea>
      <div class="composer-mention-suggestions comment-mention-suggestions" data-comment-mention-suggestions hidden></div>
      <div class="inline-comment-actions">
        <button class="text-button" type="button" data-comment-reply-cancel>Cancelar</button>
        <button class="primary-button" type="submit" ${isSubmitting ? "disabled" : ""}>
          ${isSubmitting ? "Respondendo..." : "Responder"}
        </button>
      </div>
      <p class="field-feedback" data-inline-comment-feedback></p>
    </form>
  `;
}

function renderInlineCommentItem(comment, postId, commentsById) {
  const author = comment.author || {};
  const authorName = author.displayName || "Usuário Gimerr";
  const authorHandle = author.username ? `@${author.username}` : "";
  const canDelete = state.session?.user?.id && String(author.id) === String(state.session.user.id);
  return `
    <div class="comment-thread">
      <article class="comment-item inline-comment-item" id="comment-${escapeHtml(comment.id)}">
        <a class="post-avatar" href="${getProfileUrl(author)}">
          <img src="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}" alt="">
        </a>
        <div class="comment-copy">
          <div class="comment-meta">
            <a href="${getProfileUrl(author)}">${escapeHtml(authorName)}</a>
            <span>${escapeHtml([authorHandle, formatRelativeTime(comment.createdAt)].filter(Boolean).join(" · "))}</span>
          </div>
          ${renderCommentReplyReference(comment, commentsById)}
          <p>${renderTextWithMentions(comment.body, author.username)}</p>
          <div class="comment-actions">
            <button class="text-button comment-reply-button" type="button" data-comment-reply data-post-id="${escapeHtml(postId)}" data-comment-id="${escapeHtml(comment.id)}">Responder</button>
            ${canDelete ? `
              <button class="comment-delete-button" type="button" data-comment-delete data-post-id="${escapeHtml(postId)}" data-comment-id="${escapeHtml(comment.id)}" aria-label="Apagar comentário" title="Apagar comentário">
                <img src="./assets/trash.svg" alt="">
              </button>
            ` : ""}
          </div>
          ${renderInlineCommentReplyForm(postId, comment)}
        </div>
      </article>
    </div>
  `;
}

function renderInlineCommentsPanel(post) {
  const postId = String(post.id || "");
  if (String(state.activeCommentsPostId) !== postId) return "";

  const commentState = state.commentsByPost[postId] || { items: [], hasMore: false, nextOffset: 0 };
  const isLoading = String(state.commentsLoadingPostId) === postId;
  const error = state.commentsErrorByPost[postId] || "";
  const comments = commentState.items || [];
  const commentsById = buildCommentsById(comments);
  const body = error
    ? `<p class="comments-empty">${escapeHtml(error)}</p>`
    : comments.length
      ? comments.map((comment) => renderInlineCommentItem(comment, postId, commentsById)).join("")
      : `<p class="comments-empty">${isLoading ? "Carregando comentários..." : "Nenhum comentário ainda."}</p>`;
  const moreButton = commentState.hasMore
    ? `<button class="text-button inline-comments-more" type="button" data-post-comments-more data-post-id="${escapeHtml(postId)}" ${isLoading ? "disabled" : ""}>${isLoading ? "Carregando..." : "Ver mais comentários"}</button>`
    : "";

  return `
    <div class="inline-comments-panel">
      <div class="comments-list">
        ${body}
      </div>
      ${moreButton}
    </div>
  `;
}

async function loadInlineComments(postId, { append = false } = {}) {
  const id = String(postId || "");
  if (!id || state.commentsLoadingPostId) return;

  const current = state.commentsByPost[id] || { items: [], hasMore: false, nextOffset: 0 };
  const offset = append ? Number(current.nextOffset || current.items?.length || 0) : 0;
  state.commentsLoadingPostId = id;
  state.commentsErrorByPost[id] = "";
  renderFeed({ prepareVideos: false });

  try {
    const response = await fetch(`/api/posts/comments?postId=${encodeURIComponent(id)}&limit=3&offset=${offset}`, {
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar comentários.");

    state.commentsByPost[id] = {
      items: append ? [...(current.items || []), ...(payload.comments || [])] : (payload.comments || []),
      hasMore: Boolean(payload.hasMore),
      nextOffset: Number(payload.nextOffset || 0),
    };
  } catch (error) {
    state.commentsErrorByPost[id] = error.message || "Não foi possível carregar comentários.";
  } finally {
    state.commentsLoadingPostId = "";
    renderFeed({ prepareVideos: false });
  }
}

function renderInlineCommentForm(post) {
  if (String(state.activeCommentPostId) !== String(post.id)) return "";
  if (!state.session?.access_token) {
    return `<a class="text-button inline-comment-login" href="./sign-in.html">Entre para comentar</a>`;
  }
  const isSubmitting = String(state.commentSubmittingPostId) === String(post.id);
  return `
    <form class="inline-comment-form" data-inline-comment-form data-post-id="${escapeHtml(post.id)}">
      <textarea maxlength="500" rows="2" placeholder="Escreva um comentário"></textarea>
      <div class="composer-mention-suggestions comment-mention-suggestions" data-comment-mention-suggestions hidden></div>
      <div class="inline-comment-actions">
        <span>Até 500 caracteres.</span>
        <button class="primary-button" type="submit" ${isSubmitting ? "disabled" : ""}>
          ${isSubmitting ? "Comentando..." : "Comentar"}
        </button>
      </div>
      <p class="field-feedback" data-inline-comment-feedback></p>
    </form>
  `;
}

async function submitInlineComment(form) {
  const postId = form.dataset.postId || "";
  const parentCommentId = form.dataset.parentCommentId || "";
  const submitKey = parentCommentId || postId;
  const textarea = form.querySelector("textarea");
  const feedback = form.querySelector("[data-inline-comment-feedback]");
  const body = textarea?.value?.trim() || "";
  if (!postId || !body || state.commentSubmittingPostId) {
    textarea?.focus();
    return;
  }

  state.commentSubmittingPostId = submitKey;
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Comentando...";
  }

  try {
    const response = await fetch("/api/posts/comments", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ postId, body, parentCommentId: parentCommentId || null }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível comentar.");

    state.posts = state.posts.map((post) => (
      String(post.id) === String(postId)
        ? { ...post, commentCount: Number(post.commentCount || 0) + 1 }
        : post
    ));
    if (state.commentsByPost[postId]?.items) {
      state.commentsByPost[postId] = {
        ...state.commentsByPost[postId],
        items: [...state.commentsByPost[postId].items, payload.comment].filter(Boolean),
        nextOffset: Number(state.commentsByPost[postId].nextOffset || 0) + 1,
      };
    }
    if (parentCommentId) {
      state.replyingToCommentId = "";
    } else {
      state.activeCommentPostId = "";
    }
  } catch (error) {
    if (parentCommentId) {
      state.replyingToCommentId = parentCommentId;
    } else {
      state.activeCommentPostId = postId;
    }
    if (feedback) {
      feedback.textContent = error.message || "Não foi possível comentar.";
      feedback.className = "field-feedback is-error";
    }
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Comentar";
    }
  } finally {
    state.commentSubmittingPostId = "";
    if (String(state.activeCommentPostId) !== String(postId) || parentCommentId) renderFeed({ prepareVideos: false });
  }
}

function removeCommentsFromList(comments, deletedIds) {
  const ids = new Set((deletedIds || []).map(String));
  return (comments || [])
    .filter((comment) => !ids.has(String(comment.id)))
    .map((comment) => (
      ids.has(String(comment.parentCommentId))
        ? {
          ...comment,
          parent: {
            id: comment.parentCommentId,
            status: "deleted",
            body: "",
            author: {},
          },
        }
        : comment
    ));
}

async function deleteInlineComment(postId, commentId) {
  if (!state.session?.access_token) return;
  const confirmed = window.confirm("Apagar este comentário?");
  if (!confirmed) return;

  const response = await fetch("/api/posts/comment-delete", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ commentId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível apagar comentário.");

  const deletedIds = payload.deletedCommentIds || [commentId];
  const deletedCount = Number(payload.deletedCount || deletedIds.length || 1);
  if (state.commentsByPost[postId]?.items) {
    state.commentsByPost[postId] = {
      ...state.commentsByPost[postId],
      items: removeCommentsFromList(state.commentsByPost[postId].items, deletedIds),
      nextOffset: Math.max(0, Number(state.commentsByPost[postId].nextOffset || 0) - deletedCount),
    };
  }
  state.posts = state.posts.map((post) => (
    String(post.id) === String(postId)
      ? { ...post, commentCount: Math.max(0, Number(post.commentCount || 0) - deletedCount) }
      : post
  ));
  if (deletedIds.map(String).includes(String(state.replyingToCommentId))) {
    state.replyingToCommentId = "";
  }
  renderFeed({ prepareVideos: false });
}

async function reportPost(postId) {
  if (!state.session?.access_token) {
    window.location.assign("./sign-in.html");
    return;
  }

  window.GimerrReport?.open({
    postId,
    token: state.session.access_token,
  });
}

async function reportProfile() {
  if (!state.session?.access_token) {
    window.location.assign("./sign-in.html");
    return;
  }

  window.GimerrReport?.open({
    type: "profile",
    profileId: profileInfo.id,
    token: state.session.access_token,
  });
}

async function deletePost(postId) {
  if (!state.session?.access_token) return;
  const confirmed = window.confirm("Apagar este post? Essa ação é irreversível.");
  if (!confirmed) return;

  const response = await fetch("/api/posts/delete", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ postId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível apagar este post.");

  state.posts = state.posts.filter((post) => String(post.id) !== String(postId));
  state.postsCount = Math.max(0, state.postsCount - 1);
  renderCounts();
  renderFeed();
}

async function editPostText(postId) {
  state.editingPostId = String(postId || "");
  closePostMenus();
  renderFeed({ prepareVideos: false });
  window.setTimeout(() => {
    const textarea = document.querySelector(`[data-post-edit-form][data-post-id="${CSS.escape(String(postId || ""))}"] textarea`);
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  });
}

async function savePostText(postId, body) {
  if (!state.session?.access_token) return;
  const post = state.posts.find((item) => String(item.id) === String(postId));
  if (!post || post.type === "listing") return;
  state.editSubmittingPostId = String(postId || "");
  const response = await fetch("/api/posts/update", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ postId, body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível editar este post.");

  state.posts = state.posts.map((item) => (
    String(item.id) === String(postId)
      ? { ...item, body: payload.post?.body ?? String(body || "").trim() }
      : item
  ));
  state.editingPostId = "";
  state.editSubmittingPostId = "";
  renderFeed({ prepareVideos: false });
}

function renderFeed({ prepareVideos = true } = {}) {
  if (state.loading) return;
  if (state.profileMissing) return;
  window.GimerrVideoPlayer?.stopAll?.(els.feedList);
  const query = els.search?.value?.trim().toLowerCase() || "";
  const isListingFilter = state.feedFilter === "listing";
  const baseItems = state.posts.filter((post) => isListingFilter ? post.type === "listing" : post.type !== "listing");
  const filtered = baseItems.filter((post) => {
    if (!query) return true;
    const listingData = post.type === "listing" ? getListingCardData(post) : null;
    return [
      post.body,
      post.type,
      post.gameName,
      ...(listingData?.items || []).flatMap((item) => [item.name, item.priceLabel]),
    ].join(" ").toLowerCase().includes(query);
  });
  const isMarketplaceGrid = isListingFilter;
  els.feedList.classList.toggle("is-marketplace-grid", isMarketplaceGrid);
  els.feedList.classList.toggle("is-empty", !filtered.length);
  if (els.feedSubtitle) {
    els.feedSubtitle.textContent = isListingFilter
      ? "Anúncios publicados por este usuário."
      : "Publicações deste usuário.";
  }

  if (!filtered.length) {
    els.feedList.innerHTML = `<div class="post-card empty-state">${isListingFilter ? "Nenhum anúncio publicado por aqui." : "Nenhuma publicação por aqui."}</div>`;
    return;
  }

  els.feedList.innerHTML = filtered.map((post, index) => {
    const isListing = post.type === "listing";
    const listingData = isListing ? getListingCardData(post) : null;
    const bodyText = isListing ? getListingPreviewText(listingData) : post.body;
    const media = renderPostMedia(post);
    const gameUrl = post.gameSlug
      ? `./game?slug=${encodeURIComponent(post.gameSlug)}`
      : `./game?id=${encodeURIComponent(post.gameId)}`;
    const authorName = profileInfo.displayName || profileInfo.username || "Usuário Gimerr";
    const cardHtml = `
      <article class="post-card${isListing ? " marketplace-post-card" : ""}">
        ${media}
        ${renderProfilePostTools(post)}
        <div class="post-body">
          ${isListing ? "" : renderMentionLine(authorName, profileInfo.username, post)}
          <div>
            ${renderPostTextBlock(post, bodyText ? escapeHtml(bodyText) : "")}
          </div>
          <a class="channel-line" href="${gameUrl}">
            <span class="channel-game-logo" aria-hidden="true">
              <img src="${escapeHtml(post.gameCoverUrl || "./assets/avatar.svg")}" alt="">
            </span>
            <span>Em ${escapeHtml(post.gameName || "Game")}${isListing ? "" : ` ${escapeHtml(formatRelativeTime(post.createdAt))}`}</span>
          </a>
          ${renderPostActions(post)}
        </div>
      </article>
    `;
    const position = index + 1;
    const adInterval = 10;
    const firstAdPosition = filtered.length < adInterval ? Math.max(1, Math.ceil(filtered.length / 2)) : adInterval;
    const shouldInsertAd = filtered.length >= 1
      && (position === firstAdPosition || (position > firstAdPosition && (position - firstAdPosition) % adInterval === 0));
    const adHtml = isListingFilter && isListing && shouldInsertAd ? (window.GimerrAdcashAds?.renderMarketplaceAdCard?.() || "") : "";
    return `${cardHtml}${adHtml}`;
  }).join("");
  if (prepareVideos) window.GimerrVideoPlayer?.prepare(els.feedList);
  if (isListingFilter) window.GimerrAdcashAds?.prepareMarketplaceAds?.(els.feedList);
}

function setProfileFeedFilter(filter) {
  state.feedFilter = filter === "listing" ? "listing" : "all";
  els.filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.profileFeedFilter === state.feedFilter);
  });
  renderFeed();
}

function renderPersonAvatar(user) {
  if (user.avatar_url) {
    return `<img src="${escapeHtml(user.avatar_url)}" alt="">`;
  }
  return `<img src="./assets/avatar.svg" alt="">`;
}

function openPeopleModal(title, users) {
  els.peopleModalTitle.textContent = title;
  if (!users.length) {
    els.peopleList.innerHTML = `<div class="empty-state">Nenhum usuário por aqui.</div>`;
  } else {
    els.peopleList.innerHTML = users.map((user) => `
      <a class="people-row" href="${getProfileUrl(user)}">
        <div class="post-avatar">${renderPersonAvatar(user)}</div>
        <div>
          <strong>${escapeHtml(user.display_name || user.username || "Usuário Gimerr")}</strong>
          ${user.username ? `<span>@${escapeHtml(user.username)}</span>` : ""}
        </div>
      </a>
    `).join("");
  }
  els.peopleModal.hidden = false;
  els.peopleModalClose.focus();
}

function closePeopleModal() {
  els.peopleModal.hidden = true;
}

async function toggleRecommendation() {
  if (!state.session?.user || !profileInfo.id) {
    window.location.assign("./sign-in.html");
    return;
  }

  const client = await window.GimerrAuth.getClient();
  const nextRecommended = !state.recommended;
  els.recommendButton.disabled = true;
  setRecommendButtonLabel(nextRecommended ? "Recomendando..." : "Removendo...");

  try {
    if (nextRecommended) {
      const { error } = await client
        .from("profile_recommendations")
        .upsert({
          recommender_id: state.session.user.id,
          recommended_id: profileInfo.id,
        }, { onConflict: "recommender_id,recommended_id", ignoreDuplicates: true });
      if (error) throw error;
    } else {
      const { error } = await client
        .from("profile_recommendations")
        .delete()
        .eq("recommender_id", state.session.user.id)
        .eq("recommended_id", profileInfo.id);
      if (error) throw error;
    }

    await loadProfileStats(client, profileInfo.id, state.session.user.id);
    renderCounts();
    renderActions();
  } catch (error) {
    console.warn("Não foi possível atualizar recomendação.", error);
    window.alert(error.message || "Não foi possível atualizar recomendação.");
    renderActions();
  }
}

els.search?.addEventListener("input", renderFeed);
els.filterButtons.forEach((button) => {
  button.addEventListener("click", () => setProfileFeedFilter(button.dataset.profileFeedFilter));
});
els.recommendButton.addEventListener("click", toggleRecommendation);
els.reportProfileButton.addEventListener("click", reportProfile);
els.recommendationsButton.addEventListener("click", () => openPeopleModal("Recomendações", state.recommendations));
els.peopleModalClose.addEventListener("click", closePeopleModal);

els.peopleModal.addEventListener("click", (event) => {
  if (event.target === els.peopleModal) closePeopleModal();
});

els.listingDetailModal?.addEventListener("click", (event) => {
  if (event.target === els.listingDetailModal) closeListingDetailModal();
});

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;

  const menuToggle = target.closest("[data-post-menu-toggle]");
  if (menuToggle) {
    event.preventDefault();
    togglePostMenu(menuToggle);
    return;
  }

  const closeListingButton = target.closest("[data-listing-close]");
  if (closeListingButton) {
    event.preventDefault();
    closePostMenus();
    closeListingDetailModal();
    return;
  }

  const shareButton = target.closest("[data-post-share]");
  if (shareButton) {
    event.preventDefault();
    closePostMenus();
    try {
      await sharePost(shareButton.dataset.postId);
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Não foi possível compartilhar post.", error);
      window.alert("Não foi possível compartilhar este post.");
    }
    return;
  }

  const listingCard = target.closest("[data-listing-open]");
  if (listingCard) {
    event.preventDefault();
    closePostMenus();
    await openListingDetail(listingCard.dataset.postId || "");
    return;
  }

  const editPostButton = target.closest("[data-post-edit]");
  if (editPostButton) {
    event.preventDefault();
    closePostMenus();
    try {
      await editPostText(editPostButton.dataset.postId || "");
    } catch (error) {
      console.warn("Não foi possível editar post.", error);
      window.alert(error.message || "Não foi possível editar este post.");
    }
    return;
  }

  const editPostCancelButton = target.closest("[data-post-edit-cancel]");
  if (editPostCancelButton) {
    event.preventDefault();
    state.editingPostId = "";
    state.editSubmittingPostId = "";
    renderFeed({ prepareVideos: false });
    return;
  }

  const commentToggle = target.closest("[data-post-comment-toggle]");
  if (commentToggle) {
    event.preventDefault();
    const postId = commentToggle.dataset.postId || "";
    const willOpen = String(state.activeCommentPostId) !== String(postId);
    state.activeCommentPostId = willOpen ? postId : "";
    if (willOpen) state.activeCommentsPostId = postId;
    renderFeed({ prepareVideos: false });
    if (willOpen && !state.commentsByPost[postId]) {
      await loadInlineComments(postId);
    }
    window.setTimeout(() => {
      document.querySelector(`[data-inline-comment-form][data-post-id="${CSS.escape(postId)}"] textarea`)?.focus();
    });
    return;
  }

  const commentsToggle = target.closest("[data-post-comments-toggle]");
  if (commentsToggle) {
    event.preventDefault();
    const postId = commentsToggle.dataset.postId || "";
    const willOpen = String(state.activeCommentsPostId) !== String(postId);
    state.activeCommentsPostId = willOpen ? postId : "";
    renderFeed({ prepareVideos: false });
    if (willOpen && !state.commentsByPost[postId]) {
      await loadInlineComments(postId);
    }
    return;
  }

  const commentsMoreButton = target.closest("[data-post-comments-more]");
  if (commentsMoreButton) {
    event.preventDefault();
    await loadInlineComments(commentsMoreButton.dataset.postId || "", { append: true });
    return;
  }

  const commentDeleteButton = target.closest("[data-comment-delete]");
  if (commentDeleteButton) {
    event.preventDefault();
    try {
      await deleteInlineComment(commentDeleteButton.dataset.postId || "", commentDeleteButton.dataset.commentId || "");
    } catch (error) {
      console.warn("Não foi possível apagar comentário.", error);
      window.alert(error.message || "Não foi possível apagar comentário.");
    }
    return;
  }

  const replyButton = target.closest("[data-comment-reply]");
  if (replyButton) {
    event.preventDefault();
    const postId = replyButton.dataset.postId || "";
    const commentId = replyButton.dataset.commentId || "";
    state.activeCommentsPostId = postId;
    state.replyingToCommentId = String(state.replyingToCommentId) === String(commentId) ? "" : commentId;
    renderFeed({ prepareVideos: false });
    window.setTimeout(() => {
      const textarea = document.querySelector(`[data-parent-comment-id="${CSS.escape(commentId)}"] textarea`);
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    });
    return;
  }

  const replyCancelButton = target.closest("[data-comment-reply-cancel]");
  if (replyCancelButton) {
    event.preventDefault();
    state.replyingToCommentId = "";
    renderFeed({ prepareVideos: false });
    return;
  }

  const reportButton = target.closest("[data-post-report]");
  if (reportButton) {
    event.preventDefault();
    closePostMenus();
    try {
      await reportPost(reportButton.dataset.postId);
    } catch (error) {
      console.warn("Não foi possível denunciar post.", error);
      window.alert(error.message || "Não foi possível denunciar este post.");
    }
    return;
  }

  const deleteButton = target.closest("[data-post-delete]");
  if (deleteButton) {
    event.preventDefault();
    closePostMenus();
    try {
      await deletePost(deleteButton.dataset.postId);
    } catch (error) {
      console.warn("Não foi possível apagar post.", error);
      window.alert(error.message || "Não foi possível apagar este post.");
    }
    return;
  }

  if (!target.closest("[data-post-menu]")) {
    closePostMenus();
  }
});

document.addEventListener("submit", async (event) => {
  const editForm = event.target instanceof Element ? event.target.closest("[data-post-edit-form]") : null;
  if (editForm) {
    event.preventDefault();
    const postId = editForm.dataset.postId || "";
    const textarea = editForm.querySelector("textarea");
    try {
      await savePostText(postId, textarea?.value || "");
    } catch (error) {
      console.warn("Não foi possível editar post.", error);
      state.editSubmittingPostId = "";
      window.alert(error.message || "Não foi possível editar este post.");
    }
    return;
  }

  const form = event.target instanceof Element ? event.target.closest("[data-inline-comment-form]") : null;
  if (!form) return;
  event.preventDefault();
  await submitInlineComment(form);
});

document.addEventListener("input", (event) => {
  const textarea = event.target instanceof Element ? event.target.closest("[data-inline-comment-form] textarea") : null;
  if (!textarea) return;
  updateCommentMentionSuggestions(textarea);
});

document.addEventListener("mousedown", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-comment-mention-index]")
    : null;
  if (!button) return;
  event.preventDefault();
  const profile = state.commentMention.items[Number(button.dataset.commentMentionIndex || 0)];
  insertCommentMention(profile);
});

document.addEventListener("keydown", (event) => {
  const textarea = event.target instanceof Element ? event.target.closest("[data-inline-comment-form] textarea") : null;
  if (textarea && state.commentMention.active && state.commentMention.items.length) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.commentMention.selectedIndex = (state.commentMention.selectedIndex + 1) % state.commentMention.items.length;
      renderCommentMentionSuggestions();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      state.commentMention.selectedIndex = (state.commentMention.selectedIndex - 1 + state.commentMention.items.length) % state.commentMention.items.length;
      renderCommentMentionSuggestions();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertCommentMention(state.commentMention.items[state.commentMention.selectedIndex]);
      return;
    }
  }
  if (event.key === "Escape") {
    if (!els.listingDetailModal?.hidden) closeListingDetailModal();
    if (!els.peopleModal.hidden) closePeopleModal();
    closePostMenus();
    closeCommentMentionSuggestions();
  }
});

document.addEventListener("gimerr:video-view", (event) => {
  const postId = event.detail?.postId;
  const videoViewCount = Number(event.detail?.videoViewCount || 0);
  if (!postId) return;
  state.posts = state.posts.map((post) => (
    String(post.id) === String(postId)
      ? { ...post, videoViewCount }
      : post
  ));
});

async function init() {
  if (redirectLegacySharedPostUrl()) return;

  els.recommendButton.disabled = true;
  await hydrateAuthenticatedProfile();
  state.loading = false;
  els.layout.classList.remove("is-loading");
  renderCounts();
  renderActions();
  renderPublicInfo();
  renderFeed();
}

init();
