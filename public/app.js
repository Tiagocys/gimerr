let posts = [];

const DISCORD_INVITE_FALLBACK = "https://discord.gg/tCPVFu6juS";
const LISTING_CURRENCY_SYMBOLS = {
  BRL: "R$",
  USD: "$",
  EUR: "€",
  JPY: "¥",
  GBP: "£",
  CNY: "¥",
};
const LISTING_VIDEO_MAX_BYTES = 500 * 1024 * 1024;
const LISTING_VIDEO_MAX_SECONDS = 180;
const LISTING_VIDEO_THUMBNAIL_MAX_WIDTH = 640;
const LISTING_VIDEO_THUMBNAIL_QUALITY = 0.72;
const POST_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const POST_VIDEO_MAX_BYTES = 500 * 1024 * 1024;
const STANDARD_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const SIDEBAR_PAGE_SIZE = 12;

const state = {
  filter: "all",
  search: "",
  marketplaceSearch: "",
  composerMode: "post",
  listingCurrency: "",
  editingListingPostId: "",
  editingListingVideoItem: null,
  signedIn: false,
  session: null,
  currentProfile: null,
  followedGames: [],
  availableGames: [],
  followedProfiles: [],
  sidebarMode: "guest",
  sidebarLoading: false,
  sidebarHasMore: true,
  sidebarOffset: 0,
  liveUpdates: [],
  preparedMediaFile: null,
  composerSelectedFiles: [],
  composerPreviewUrls: [],
  listingItemDrafts: [],
  composerGameResults: [],
  composerSelectedGame: null,
  composerGameSearchTimer: null,
  composerGameSearchRequestId: 0,
  feedLoading: false,
  feedHasMore: true,
  feedOffset: 0,
  feedPageSize: 8,
  activeCommentPostId: "",
  activeCommentsPostId: "",
  commentSubmittingPostId: "",
  editingPostId: "",
  editSubmittingPostId: "",
  replyingToCommentId: "",
  commentsLoadingPostId: "",
  commentsByPost: {},
  commentsErrorByPost: {},
  listingSellerCache: new Map(),
  filterSeenAt: {
    all: new Date().toISOString(),
    listing: new Date().toISOString(),
  },
  mention: {
    active: false,
    start: -1,
    end: -1,
    selectedIndex: 0,
    items: [],
  },
  commentMention: {
    active: false,
    start: -1,
    end: -1,
    selectedIndex: 0,
    items: [],
    textarea: null,
  },
};

let feedObserver = null;
let sidebarObserver = null;

const els = {
  indexSidebar: document.querySelector("#index-sidebar"),
  followedGamesPanel: document.querySelector("#followed-games-panel"),
  sidebarGamesTitle: document.querySelector("#sidebar-games-title"),
  serverList: document.querySelector("#server-list"),
  serverCount: document.querySelector("#server-count"),
  serverListMore: document.querySelector("#server-list-more"),
  feedList: document.querySelector("#feed-list"),
  livePanel: document.querySelector("#live-panel"),
  liveStack: document.querySelector("#live-stack"),
  search: document.querySelector("#global-search"),
  filterButtons: document.querySelectorAll(".filter-chip"),
  filterCounts: document.querySelectorAll("[data-filter-count]"),
  marketplaceSearchWrap: document.querySelector("#marketplace-feed-search"),
  marketplaceSearch: document.querySelector("#marketplace-search"),
  composerModeButtons: document.querySelectorAll("[data-composer-mode]"),
  composerTitle: document.querySelector("#composer-title"),
  composerText: document.querySelector("#composer-text"),
  composerMentionSuggestions: document.querySelector("#composer-mention-suggestions"),
  composerEmojiButton: document.querySelector("#composer-emoji-button"),
  composerEmojiPicker: document.querySelector("#composer-emoji-picker"),
  composerServer: document.querySelector("#composer-server"),
  composerGameLabel: document.querySelector("#composer-game-label"),
  composerGameSearch: document.querySelector("#composer-game-search"),
  composerGameSelected: document.querySelector("#composer-game-selected"),
  composerGameSuggestions: document.querySelector("#composer-game-suggestions"),
  composerFile: document.querySelector("#composer-video-file") || document.querySelector("#composer-file"),
  composerImageFile: document.querySelector("#composer-image-file"),
  composerVideoFile: document.querySelector("#composer-video-file") || document.querySelector("#composer-file"),
  composerFileHelper: document.querySelector("#composer-file-helper"),
  composerVideoHelper: document.querySelector("#composer-video-helper"),
  composerMedia: document.querySelector("#composer-media"),
  composerFileName: document.querySelector("#composer-file-name"),
  composerMediaPreviews: document.querySelector("#composer-media-previews"),
  composerClearFile: document.querySelector("#composer-clear-file"),
  listingComposerFields: document.querySelector("#listing-composer-fields"),
  listingHelper: document.querySelector("#composer-listing-helper"),
  listingCurrency: document.querySelector("#listing-currency"),
  listingItems: document.querySelector("#listing-items"),
  listingItemAdd: document.querySelector("#listing-item-add"),
  cancelListingEdit: document.querySelector("#cancel-listing-edit"),
  publishPost: document.querySelector("#publish-post"),
  openComposer: document.querySelector("#open-composer"),
  closeComposer: document.querySelector("#close-composer"),
  composer: document.querySelector("#composer"),
  verificationModal: document.querySelector("#verification-modal"),
  verificationTitle: document.querySelector("#verification-title"),
  verificationSteps: document.querySelector("#verification-steps"),
  verificationFeedback: document.querySelector("#verification-feedback"),
  verificationPrimary: document.querySelector("#verification-primary"),
  verificationClose: document.querySelector("#verification-close"),
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

function cleanRouteUuid(value) {
  const text = String(value || "").trim();
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
}

function getListingRoutePostId() {
  const params = new URLSearchParams(window.location.search);
  return cleanRouteUuid(params.get("listing") || params.get("listingPostId") || "");
}

function getEditListingRoutePostId() {
  const params = new URLSearchParams(window.location.search);
  return cleanRouteUuid(params.get("editListing") || params.get("editListingPostId") || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getInitials(name) {
  return String(name || "G")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "G";
}

function cleanAuthUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code")) return;
  window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
}

function normalizeFollowedGame(row) {
  const game = row.game || row.igdb_games || {};
  return {
    id: game.igdb_id || game.id,
    name: game.name || "Game Gimerr",
    slug: game.slug || "",
    coverUrl: game.cover_url || game.coverUrl || "",
    followedAt: row.created_at,
    count: Number(game.count || row.count || 0),
    source: game.source || row.source || "",
  };
}

function normalizeFollowedProfile(profile) {
  if (!profile?.id || !profile.username) return null;
  return {
    id: profile.id,
    displayName: profile.display_name || profile.displayName || profile.username || "Usuário Gimerr",
    username: profile.username,
    avatarUrl: profile.avatar_url || profile.avatarUrl || "",
    count: Number(profile.count || 0),
  };
}

function getAvailableGames() {
  const byId = new Map();
  const addGame = (game) => {
    if (!game?.id) return;
    const id = String(game.id);
    if (!byId.has(id)) {
      byId.set(id, {
        id: game.id,
        name: game.name || "Game Gimerr",
        slug: game.slug || "",
        coverUrl: game.coverUrl || game.cover_url || "",
      });
    }
  };
  state.followedGames.forEach(addGame);
  posts.forEach((post) => addGame(post.game || getGame(post.gameId)));
  state.availableGames = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return state.availableGames;
}

function normalizeComposerGame(game) {
  if (!game) return null;
  const id = game.igdbId || game.igdb_id || game.id;
  if (!id) return null;
  return {
    id,
    name: game.name || "Game Gimerr",
    slug: game.slug || "",
    coverUrl: game.coverUrl || game.cover_url || "",
    platforms: Array.isArray(game.platforms) ? game.platforms : [],
    firstReleaseDate: game.firstReleaseDate || game.first_release_date || "",
  };
}

function addAvailableGame(game) {
  const normalized = normalizeComposerGame(game);
  if (!normalized) return null;
  const exists = state.availableGames.some((item) => String(item.id) === String(normalized.id));
  if (!exists) {
    state.availableGames = [...state.availableGames, normalized]
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }
  return normalized;
}

function getGame(gameId) {
  return (
    state.availableGames.find((game) => String(game.id) === String(gameId))
    || state.followedGames.find((game) => String(game.id) === String(gameId))
    || posts.find((post) => String(post.gameId) === String(gameId))?.game
    || null
  );
}

function getComposerGameMeta(game) {
  const platforms = Array.isArray(game?.platforms)
    ? game.platforms.slice(0, 3).map((platform) => platform.abbreviation || platform.name).filter(Boolean).join(", ")
    : "";
  return platforms || game?.firstReleaseDate || "Jogo";
}

function hideComposerGameSuggestions() {
  if (els.composerGameSuggestions) {
    els.composerGameSuggestions.hidden = true;
    els.composerGameSuggestions.innerHTML = "";
  }
}

function renderComposerGameSelection() {
  if (!els.composerGameSelected || !els.composerGameSearch) return;
  const game = state.composerSelectedGame;
  if (!game) {
    els.composerGameSelected.hidden = true;
    els.composerGameSelected.innerHTML = "";
    els.composerGameSearch.hidden = false;
    return;
  }
  els.composerGameSearch.hidden = true;
  els.composerGameSelected.hidden = false;
  els.composerGameSelected.innerHTML = `
    <span class="composer-game-chip">
      <span class="composer-game-cover" aria-hidden="true">
        ${game.coverUrl ? `<img src="${escapeHtml(game.coverUrl)}" alt="">` : escapeHtml(getInitials(game.name))}
      </span>
      <span class="composer-game-copy">
        <strong>${escapeHtml(game.name)}</strong>
        <span>${escapeHtml(getComposerGameMeta(game))}</span>
      </span>
      <button class="ghost-icon composer-game-chip-remove" type="button" data-composer-game-clear aria-label="Remover jogo selecionado">x</button>
    </span>
  `;
}

function selectComposerGame(game) {
  const normalized = addAvailableGame(game);
  if (!normalized) return;
  state.composerSelectedGame = normalized;
  state.composerGameResults = [];
  if (els.composerServer) els.composerServer.value = String(normalized.id);
  if (els.composerGameSearch) els.composerGameSearch.value = normalized.name;
  hideComposerGameSuggestions();
  renderComposerGameSelection();
  clearComposerInvalid(els.composerGameSearch);
  clearComposerInvalid(els.composerGameSelected);
  showListingHelperMessage();
}

function renderComposerGameSuggestions(games, message = "") {
  if (!els.composerGameSuggestions) return;
  if (message) {
    els.composerGameSuggestions.innerHTML = `<div class="composer-game-suggestion is-message">${escapeHtml(message)}</div>`;
    els.composerGameSuggestions.hidden = false;
    return;
  }
  if (!games.length) {
    const term = String(els.composerGameSearch?.value || "").trim();
    els.composerGameSuggestions.innerHTML = `
      <button class="composer-game-suggestion is-message" type="button" data-composer-game-submit data-query="${escapeHtml(term)}">
        <span>Não encontramos o '${escapeHtml(term || "jogo")}' na nossa base de jogos, <span class="user-search-action-highlight">clique aqui para cadastrá-lo</span></span>
      </button>
    `;
    els.composerGameSuggestions.hidden = false;
    return;
  }
  els.composerGameSuggestions.innerHTML = games.map((game) => `
    <button class="composer-game-suggestion" type="button" data-composer-game-id="${escapeHtml(game.id)}">
      <span class="composer-game-cover">
        ${game.coverUrl ? `<img src="${escapeHtml(game.coverUrl)}" alt="">` : escapeHtml(getInitials(game.name))}
      </span>
      <span class="composer-game-copy">
        <strong>${escapeHtml(game.name)}</strong>
        <span>${escapeHtml(getComposerGameMeta(game))}</span>
      </span>
    </button>
  `).join("");
  els.composerGameSuggestions.hidden = false;
}

function openComposerGameRequest(term) {
  const cleanTerm = String(term || "").trim();
  if (window.GimerrGameRequest?.open) {
    window.GimerrGameRequest.open(cleanTerm);
    return true;
  }
  window.dispatchEvent(new CustomEvent("gimerr:open-game-request", {
    detail: { term: cleanTerm },
  }));
  return Boolean(window.GimerrGameRequest?.open);
}

async function searchComposerGames(query) {
  const term = String(query || "").trim();
  state.composerGameSearchRequestId += 1;
  const requestId = state.composerGameSearchRequestId;
  if (term.length < 2) {
    hideComposerGameSuggestions();
    return;
  }
  renderComposerGameSuggestions([], "Buscando jogos...");
  try {
    const response = await fetch(`/api/games/search?q=${encodeURIComponent(term)}&limit=8`, {
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (requestId !== state.composerGameSearchRequestId) return;
    if (!response.ok) throw new Error(payload.error || "Não foi possível buscar jogos.");
    const games = (payload.games || []).map(normalizeComposerGame).filter(Boolean);
    state.composerGameResults = games;
    renderComposerGameSuggestions(games);
  } catch (error) {
    console.warn("Não foi possível buscar jogos para o anúncio.", error);
    if (requestId === state.composerGameSearchRequestId) {
      renderComposerGameSuggestions([], "Não foi possível buscar jogos agora.");
    }
  }
}

function clearComposerGameSelection() {
  state.composerSelectedGame = null;
  state.composerGameResults = [];
  if (els.composerServer) els.composerServer.value = "";
  if (els.composerGameSearch) els.composerGameSearch.value = "";
  hideComposerGameSuggestions();
  renderComposerGameSelection();
  clearComposerInvalid(els.composerGameSearch);
  clearComposerInvalid(els.composerGameSelected);
}

function getGameUrl(game) {
  if (!game) return "./game";
  return game.slug
    ? `/g/${encodeURIComponent(game.slug)}`
    : `./game?id=${encodeURIComponent(game.id)}`;
}

function getProfileUrl(profile) {
  if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
  if (profile?.id) return `./profile?id=${encodeURIComponent(profile.id)}`;
  return "./profile";
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

function renderMentionLine(authorName, post) {
  const mentions = extractMentionUsernames(post?.body, post?.author?.username);
  if (!mentions.length) return "";
  const links = mentions.map((username) => (
    `<a href="./profile?u=${encodeURIComponent(username)}">@${escapeHtml(username)}</a>`
  )).join(", ");
  return `<p class="post-mention-line"><strong>${escapeHtml(authorName)}</strong> está com ${links}</p>`;
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

function closeMentionSuggestions() {
  state.mention = {
    active: false,
    start: -1,
    end: -1,
    selectedIndex: 0,
    items: [],
  };
  if (els.composerMentionSuggestions) {
    els.composerMentionSuggestions.hidden = true;
    els.composerMentionSuggestions.innerHTML = "";
  }
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

function renderMentionSuggestions() {
  const container = els.composerMentionSuggestions;
  if (!container) return;
  if (!state.mention.active || !state.mention.items.length) {
    closeMentionSuggestions();
    return;
  }

  container.hidden = false;
  container.innerHTML = state.mention.items.map((profile, index) => `
    <button class="composer-mention-option${index === state.mention.selectedIndex ? " is-active" : ""}" type="button" data-mention-index="${index}">
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

function updateMentionSuggestions() {
  if (!els.composerText) return;
  const cursor = els.composerText.selectionStart;
  const activeMention = getActiveMention(els.composerText.value, cursor);
  if (!activeMention) {
    closeMentionSuggestions();
    return;
  }

  const items = getMentionMatches(activeMention.query);
  if (!items.length) {
    closeMentionSuggestions();
    return;
  }

  state.mention = {
    active: true,
    start: activeMention.start,
    end: activeMention.end,
    selectedIndex: Math.min(state.mention.selectedIndex || 0, items.length - 1),
    items,
  };
  renderMentionSuggestions();
}

function insertMention(profile) {
  if (!profile || !state.mention.active) return;
  const text = els.composerText.value;
  const before = text.slice(0, state.mention.start);
  const after = text.slice(state.mention.end);
  const nextValue = `${before}@${profile.username} ${after}`;
  const nextCursor = before.length + profile.username.length + 2;
  els.composerText.value = nextValue.slice(0, Number(els.composerText.maxLength || 220));
  closeMentionSuggestions();
  els.composerText.focus();
  els.composerText.setSelectionRange(nextCursor, nextCursor);
}

function renderComposerEmojiPicker() {
  if (!els.composerEmojiPicker) return;
  els.composerEmojiPicker.innerHTML = `<emoji-picker class="gimerr-emoji-picker"></emoji-picker>`;
}

function setComposerEmojiPickerOpen(open) {
  if (!els.composerEmojiPicker || !els.composerEmojiButton) return;
  const shouldOpen = Boolean(open) && state.composerMode === "post";
  if (shouldOpen && !els.composerEmojiPicker.innerHTML) {
    renderComposerEmojiPicker();
  }
  els.composerEmojiPicker.hidden = !shouldOpen;
  els.composerEmojiButton.setAttribute("aria-expanded", String(shouldOpen));
}

function insertComposerEmoji(emoji) {
  if (!els.composerText || !emoji) return;
  const textarea = els.composerText;
  const value = textarea.value || "";
  const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : value.length;
  const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
  const nextValue = `${value.slice(0, start)}${emoji}${value.slice(end)}`;
  const maxLength = Number(textarea.maxLength || 0);

  if (maxLength > 0 && nextValue.length > maxLength) {
    textarea.focus();
    return;
  }

  textarea.value = nextValue;
  const nextCursor = start + emoji.length;
  textarea.focus();
  textarea.setSelectionRange(nextCursor, nextCursor);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function isVideoFile(file) {
  return Boolean(file?.type?.startsWith("video/"));
}

function isImageFile(file) {
  return Boolean(file && STANDARD_IMAGE_TYPES.has(file.type));
}

function getPostTypeFromFile(file) {
  if (isVideoFile(file)) return "video";
  return "post";
}

function getPostTypeFromComposer(files = []) {
  if (state.composerMode === "listing") return "listing";
  const [file] = files;
  return file ? getPostTypeFromFile(file) : "post";
}

function validateComposerFile(file) {
  if (!file) return true;
  if (isVideoFile(file)) {
    if (file.size > POST_VIDEO_MAX_BYTES) {
      setVideoHelperMessage("O vídeo pode ter no máximo 500 MB.", "warning");
      markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
      return false;
    }
    setVideoHelperMessage("");
    clearComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
    return true;
  }

  if (!isImageFile(file)) {
    setVideoHelperMessage("Envie uma imagem JPG, PNG, WebP, GIF ou um vídeo MP4, WebM ou MOV.", "warning");
    markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
    return false;
  }

  if (file.size > POST_IMAGE_MAX_BYTES) {
    setVideoHelperMessage("A imagem pode ter no máximo 5 MB.", "warning");
    markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
    return false;
  }
  setVideoHelperMessage("");
  clearComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
  return true;
}

function validateComposerFiles(files, type = getPostTypeFromComposer(files)) {
  if (!files.length) return true;
  if (type === "listing") {
    if (files.length > 1) {
      setVideoHelperMessage("Anúncios aceitam apenas 1 vídeo.", "warning");
      markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
      return false;
    }
    const [file] = files;
    if (!isVideoFile(file)) {
      setVideoHelperMessage("O vídeo do anúncio precisa ser MP4, WebM ou MOV.", "warning");
      markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
      return false;
    }
    if (file.size > LISTING_VIDEO_MAX_BYTES) {
      setVideoHelperMessage("O vídeo do anúncio pode ter no máximo 500 MB.", "warning");
      markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
      return false;
    }
    setVideoHelperMessage("");
    clearComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
    return true;
  }
  return validateComposerFile(files[0]);
}

function validateListingItemImageFiles(files) {
  if (files.length > 15) {
    showListingHelperMessage("Anúncios aceitam até 15 imagens de itens.", "warning");
    return false;
  }
  if (files.some((file) => !isImageFile(file))) {
    showListingHelperMessage("As imagens dos itens precisam ser JPG, PNG, WebP ou GIF.", "warning");
    return false;
  }
  return true;
}

function readVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number(video.duration || 0));
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler a duração do vídeo."));
    };
    video.src = url;
  });
}

function createVideoThumbnailFile(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Não foi possível gerar a capa do vídeo."));
    };
    const finish = () => {
      if (settled) return;
      const sourceWidth = Number(video.videoWidth || 0);
      const sourceHeight = Number(video.videoHeight || 0);
      if (!sourceWidth || !sourceHeight) {
        fail();
        return;
      }
      const scale = Math.min(1, LISTING_VIDEO_THUMBNAIL_MAX_WIDTH / sourceWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(2, Math.round(sourceWidth * scale));
      canvas.height = Math.max(2, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        fail();
        return;
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) {
          fail();
          return;
        }
        settled = true;
        cleanup();
        const baseName = String(file.name || "video").replace(/\.[^.]+$/, "") || "video";
        resolve(new File([blob], `${baseName}-thumbnail.jpg`, { type: "image/jpeg" }));
      }, "image/jpeg", LISTING_VIDEO_THUMBNAIL_QUALITY);
    };

    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.addEventListener("loadeddata", finish, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.src = url;
    video.load();
  });
}

async function validateListingVideoDuration(files) {
  const [file] = files;
  if (!file) return true;
  let duration = 0;
  try {
    duration = await readVideoDuration(file);
  } catch (_) {
    setVideoHelperMessage("Não foi possível ler a duração do vídeo. Selecione outro arquivo.", "warning");
    markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
    return false;
  }
  if (!duration || duration > LISTING_VIDEO_MAX_SECONDS) {
    setVideoHelperMessage("O vídeo do anúncio pode ter no máximo 3 minutos.", "warning");
    markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
    return false;
  }
  setVideoHelperMessage("");
  clearComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
  return true;
}

function getListingCurrency() {
  return state.listingCurrency || "";
}

function formatListingPrice(value, currency = getListingCurrency()) {
  if (!currency) return "";
  const normalized = String(value || "").replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) return "";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(number);
}

function createListingDraftItem(overrides = {}) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    name: "",
    price: "",
    file: null,
    mediaItem: null,
    previewUrl: "",
    previewObjectUrl: false,
    ...overrides,
  };
}

function revokeListingPreview(item) {
  if (item?.previewUrl && item.previewObjectUrl) URL.revokeObjectURL(item.previewUrl);
}

function resetListingItems() {
  state.listingItemDrafts.forEach(revokeListingPreview);
  state.listingItemDrafts = [createListingDraftItem()];
  renderListingItems(state.listingItemDrafts);
}

function resetListingCurrency() {
  state.listingCurrency = "";
  if (els.listingCurrency) els.listingCurrency.value = "";
}

function ensureListingDraftItems() {
  if (!state.listingItemDrafts.length) {
    state.listingItemDrafts = [createListingDraftItem()];
  }
}

function syncListingDraftsFromDom() {
  if (!els.listingItems) return;
  const byId = new Map(state.listingItemDrafts.map((item) => [String(item.id), item]));
  const rows = Array.from(els.listingItems.querySelectorAll("[data-listing-item-row]"));
  if (!rows.length) return;
  state.listingItemDrafts = rows.map((row) => {
    const id = row.dataset.listingItemId || "";
    const previous = byId.get(id) || createListingDraftItem({ id });
    return {
      ...previous,
      name: row.querySelector("[data-listing-item-name]")?.value?.trim() || "",
      price: row.querySelector("[data-listing-item-price]")?.value?.trim() || "",
    };
  });
}

function getListingItemsFromComposer() {
  return getListingDraftItems()
    .filter((item) => item.name || item.price || item.file);
}

function getListingDraftItems() {
  syncListingDraftsFromDom();
  ensureListingDraftItems();
  return state.listingItemDrafts.map((item) => ({
    ...item,
    priceLabel: formatListingPrice(item.price),
  }));
}

function buildListingBody(text, items) {
  const itemLines = items
    .filter((item) => item.name || item.priceLabel)
    .map((item) => {
      if (item.name && item.priceLabel) return `${item.name} - ${item.priceLabel}`;
      return item.name || item.priceLabel;
    });
  return [text, itemLines.length ? `Itens:\n${itemLines.join("\n")}` : ""]
    .filter(Boolean)
    .join("\n\n");
}

function parseListingPriceInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const numeric = text
    .replace(/[^\d.,-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const number = Number(numeric);
  return Number.isFinite(number) && number >= 0 ? String(number) : "";
}

function detectListingCurrency(value) {
  const text = String(value || "");
  if (text.includes("US$")) return "USD";
  if (text.includes("€")) return "EUR";
  if (text.includes("JP¥")) return "JPY";
  if (text.includes("£")) return "GBP";
  if (text.includes("CN¥")) return "CNY";
  if (text.includes("R$")) return "BRL";
  return "";
}

function parseListingBody(body, mediaItems = []) {
  const text = String(body || "");
  const marker = "\n\nItens:\n";
  const markerIndex = text.indexOf(marker);
  const description = markerIndex >= 0 ? text.slice(0, markerIndex) : "";
  const itemsText = markerIndex >= 0 ? text.slice(markerIndex + marker.length) : text.replace(/^Itens:\n/i, "");
  const lines = itemsText.split("\n").map((line) => line.trim()).filter(Boolean);
  let detectedCurrency = "";
  const mediaByPosition = new Map(mediaItems
    .filter((item) => Number.isInteger(Number(item?.position)))
    .map((item) => [Number(item.position), item]));
  const mediaByName = new Map(mediaItems
    .filter((item) => item?.itemName)
    .map((item) => [String(item.itemName).toLowerCase(), item]));
  const getMediaForLine = (name, index) => (
    mediaByPosition.get(index)
    || mediaByName.get(String(name || "").toLowerCase())
    || null
  );
  const items = lines.map((line, index) => {
    const [namePart, ...priceParts] = line.split(/\s+-\s+/);
    const mediaItem = getMediaForLine(namePart, index);
    const priceLabel = priceParts.join(" - ") || mediaItem?.priceLabel || "";
    if (!detectedCurrency) detectedCurrency = detectListingCurrency(priceLabel);
    return createListingDraftItem({
      name: namePart || mediaItem?.itemName || "",
      price: parseListingPriceInput(priceLabel),
      priceLabel,
      mediaItem,
      previewUrl: mediaItem?.url || "",
      previewObjectUrl: false,
    });
  });
  return {
    description,
    currency: detectedCurrency || "BRL",
    items: items.length ? items : [createListingDraftItem()],
  };
}

function getListingCardData(post) {
  const rawMediaItems = Array.isArray(post?.mediaItems) ? post.mediaItems : getPostMediaItems(post);
  const parsed = parseListingBody(post?.body || "", rawMediaItems);
  return {
    ...parsed,
    itemCount: parsed.items.filter((item) => item.name || item.price || item.priceLabel || item.mediaItem || item.previewUrl).length,
  };
}

function getListingPreviewText(listingData) {
  return truncateText(
    listingData?.description
    || listingData?.items?.find((item) => item.name)?.name
    || "",
    58,
  );
}

function formatListingItemCount(count) {
  const value = Number(count || 0);
  if (value === 1) return "1 item";
  return `${new Intl.NumberFormat("pt-BR").format(value)} itens`;
}

function truncateText(value, maxLength = 110) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function validateListingItems(items) {
  clearListingItemInvalidHighlights();
  if (!items.length) {
    showListingHelperMessage("Adicione pelo menos um item com preço.", "warning");
    markListingItemInvalidFields();
    return false;
  }
  const incomplete = items.some((item) => !item.name || !item.priceLabel);
  if (incomplete) {
    showListingHelperMessage("Cada item do anúncio precisa ter nome e preço.", "warning");
    markListingItemInvalidFields();
    return false;
  }
  return true;
}

function showListingHelperMessage(message = "", tone = "") {
  if (!els.listingHelper) return;
  els.listingHelper.textContent = message;
  els.listingHelper.hidden = !message;
  els.listingHelper.className = `composer-submit-helper${tone ? ` is-${tone}` : ""}`;
}

function setVideoHelperMessage(message = "", tone = "") {
  if (!els.composerVideoHelper) return;
  els.composerVideoHelper.textContent = message;
  els.composerVideoHelper.hidden = !message;
  els.composerVideoHelper.className = `composer-step-helper${tone ? ` is-${tone}` : ""}`;
}

function markComposerInvalid(element) {
  element?.classList?.add("is-composer-invalid");
}

function clearComposerInvalid(element) {
  element?.classList?.remove("is-composer-invalid");
}

function clearListingItemInvalidHighlights() {
  els.listingItems?.querySelectorAll(".is-composer-invalid").forEach((element) => {
    element.classList.remove("is-composer-invalid");
  });
}

function clearComposerFieldInvalidState(target) {
  if (!target) return;
  clearComposerInvalid(target);
  clearComposerInvalid(target.closest?.(".price-input"));
}

function markListingItemInvalidFields() {
  const rows = Array.from(els.listingItems?.querySelectorAll("[data-listing-item-row]") || []);
  rows.forEach((row) => {
    const nameInput = row.querySelector("[data-listing-item-name]");
    const priceInput = row.querySelector("[data-listing-item-price]");
    if (!nameInput?.value?.trim()) markComposerInvalid(nameInput);
    if (!priceInput?.value?.trim()) markComposerInvalid(priceInput?.closest(".price-input") || priceInput);
  });
}

function validateListingCurrency() {
  if (getListingCurrency()) {
    clearComposerInvalid(els.listingCurrency);
    return true;
  }
  showListingHelperMessage("Selecione uma moeda para o anúncio.", "warning");
  markComposerInvalid(els.listingCurrency);
  els.listingCurrency?.focus();
  return false;
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "agora";

  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return "agora";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `há ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `há ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `há ${diffDays} d`;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function renderPostMenu(post, options = {}) {
  const postId = escapeHtml(post.id);
  const ownerId = post.author?.id || post.profileId || post.profile_id || "";
  const isOwner = state.session?.user?.id && String(ownerId) === String(state.session.user.id);
  const isListing = isMarketplacePost(post);
  const inListingDetail = Boolean(options.inListingDetail);
  return `
    <div class="post-menu" data-post-menu>
      <button class="ghost-icon post-menu-button" type="button" data-post-menu-toggle data-post-id="${postId}" aria-label="Abrir menu do post" aria-expanded="false">
        <span aria-hidden="true">&#8942;</span>
      </button>
      <div class="post-menu-popover" hidden>
        ${isListing ? (inListingDetail
          ? `<button type="button" data-listing-close>Fechar anúncio</button>`
          : `<button type="button" data-listing-open data-post-id="${postId}">Ver anúncio</button>`) : ""}
        ${isListing && !inListingDetail ? `<button type="button" data-post-share data-post-id="${postId}">Compartilhar</button>` : ""}
        ${!isOwner ? `<button type="button" data-post-report data-post-id="${postId}">Denunciar</button>` : ""}
        ${!isOwner && post.author?.id ? `<button type="button" data-user-ignore data-profile-id="${escapeHtml(post.author.id)}">Ignorar usuário</button>` : ""}
        ${isOwner && isListing ? `<button type="button" data-listing-edit data-post-id="${postId}">Editar</button>` : ""}
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

async function ignoreUser(profileId) {
  if (!state.session?.access_token) {
    window.location.assign("./sign-in.html");
    return;
  }

  const author = posts.find((post) => post.author?.id === profileId)?.author;
  const label = author?.displayName || author?.username || "este usuário";
  if (!window.confirm(`Ignorar ${label}? Os posts deste usuário sairão do seu feed e as mensagens irão para a caixa de spam.`)) return;

  const response = await fetch("/api/users/ignore", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ profileId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível ignorar este usuário.");

  posts = posts.filter((post) => post.author?.id !== profileId);
  renderFeed({ prepareVideos: false });
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

function setVerificationFeedback(message, tone = "") {
  els.verificationFeedback.textContent = message || "";
  els.verificationFeedback.className = `field-feedback${tone ? ` is-${tone}` : ""}`;
}

function getVerificationInviteUrl(status = {}) {
  return status.serverInviteUrl || DISCORD_INVITE_FALLBACK;
}

function renderVerificationSteps(status = {}) {
  const channelName = status.verifyChannelName || "gimerr-verification";
  const inviteUrl = getVerificationInviteUrl(status);
  const inviteButton = inviteUrl
    ? `<a class="verification-action-button" href="${escapeHtml(inviteUrl)}" target="_blank" rel="noopener">
        <img src="/assets/share.svg" width="18" height="18" alt="">
        <span>Entrar no servidor oficial</span>
      </a>`
    : "";

  els.verificationSteps.innerHTML = `
  <div class="verification-step">
    <strong>1. Entre no servidor oficial do Gimerr</strong>
    <span>O servidor usa a verificação do próprio Discord para reduzir spam e contas falsas.</span>
    ${inviteButton || "<span>O convite do servidor oficial ainda não está configurado.</span>"}
  </div>
  <div class="verification-step">
    <strong>2. Clique no botão do bot no canal #${escapeHtml(channelName)}</strong>
    <span>No canal #${escapeHtml(channelName)}, clique em <code>Verify with Gimerr</code>. O bot enviará um link seguro só para você.</span>
  </div>
  <div class="verification-step">
    <strong>3. Entre no Gimerr com Discord</strong>
    <span>Abra o link enviado pelo bot e autentique com o mesmo Discord usado no servidor. Depois disso sua conta será liberada para publicar.</span>
  </div>
  `;
}

function openVerificationModal(status = {}, options = {}) {
  if (els.verificationTitle) {
    els.verificationTitle.textContent = options.title || "Verifique sua conta no Discord";
  }
  renderVerificationSteps(status);
  setVerificationFeedback("");
  els.verificationPrimary.innerHTML = `<img src="/assets/share.svg" width="18" height="18" alt=""><span>Abrir servidor do Discord</span>`;
  els.verificationPrimary.dataset.action = "open_invite";
  els.verificationPrimary.dataset.invite = getVerificationInviteUrl(status);
  els.verificationPrimary.dataset.code = "";
  els.verificationModal.hidden = false;
  els.verificationPrimary.focus();
}

function closeVerificationModal() {
  els.verificationModal.hidden = true;
}

async function loadVerificationStatus() {
  const response = await fetch("/api/verification/status", {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a verificação.");
  return payload;
}

async function startDiscordVerification() {
  const response = await fetch("/api/discord/start", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ redirectPath: "/" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível iniciar Discord.");
  window.location.assign(payload.authorizeUrl);
}

async function generateDiscordVerificationCode() {
  els.verificationPrimary.disabled = true;
  els.verificationPrimary.textContent = "Gerando...";
  setVerificationFeedback("");

  try {
    const response = await fetch("/api/verification/discord-challenge", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível gerar código.");

    const invite = payload.serverInviteUrl
      ? `<a class="text-link" href="${escapeHtml(payload.serverInviteUrl)}" target="_blank" rel="noopener">Entrar no servidor oficial</a>`
      : "";
    els.verificationSteps.innerHTML = `
      <div class="verification-step">
        <strong>Seu código</strong>
        <span class="verification-code">${escapeHtml(payload.code)}</span>
      </div>
      <div class="verification-step">
        <strong>Envie no canal #${escapeHtml(payload.verifyChannelName || "gimerr-verification")}</strong>
        <span>Entre no servidor oficial do Gimerr e envie exatamente este código no canal de verificação.</span>
        ${invite}
      </div>
    `;
    els.verificationPrimary.textContent = "Copiar código";
    els.verificationPrimary.dataset.action = "copy";
    els.verificationPrimary.dataset.code = payload.code;
    setVerificationFeedback("Após enviar o código no Discord, tente publicar novamente.", "success");
  } finally {
    els.verificationPrimary.disabled = false;
  }
}

async function completeDiscordConnectionFromCallback() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("discord");
  if (!status) return;

  if (status === "complete") {
    if (!state.session?.access_token) {
      openVerificationModal({});
      setVerificationFeedback("Entre novamente para concluir a conexão com Discord.", "warning");
      return;
    }
    try {
      setVerificationFeedback("Salvando conexão Discord...");
      const response = await fetch("/api/discord/complete", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${state.session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ result: params.get("result") }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível concluir Discord.");
      const verificationStatus = await loadVerificationStatus();
      openVerificationModal(verificationStatus);
      setVerificationFeedback("Discord conectado. Entre no servidor oficial e envie verificar no canal indicado.", "success");
    } catch (error) {
      openVerificationModal({});
      setVerificationFeedback(error.message || "Não foi possível conectar Discord.", "error");
    }
  } else if (status === "cancelled") {
    openVerificationModal({});
    setVerificationFeedback("Conexão com Discord cancelada.", "warning");
  } else if (status === "error") {
    openVerificationModal({});
    setVerificationFeedback(params.get("message") || "Não foi possível conectar Discord.", "error");
  }

  window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
}

async function sharePost(postId) {
  const url = getPostShareUrl(postId);
  const post = posts.find((item) => String(item.id) === String(postId));
  const gameName = post?.game?.name || getGame(post?.gameId)?.name || "Gimerr";
  const title = post?.type === "video"
    ? `Veja este vídeo no Gimerr`
    : `Veja este post no Gimerr`;

  if (window.GimerrShare?.openPostShare) {
    await window.GimerrShare.openPostShare({
      postId,
      post,
      title,
      text: `Publicado em ${gameName}`,
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

function formatListingViewCount(value) {
  const count = Number(value || 0);
  if (count >= 1000) {
    const compact = Math.floor(count / 1000);
    return `${new Intl.NumberFormat("pt-BR").format(compact)}k`;
  }
  return new Intl.NumberFormat("pt-BR").format(count);
}

function formatListingViewBadge(value) {
  const count = Number(value || 0);
  return `${formatListingViewCount(count)} ${count === 1 ? "visualização" : "visualizações"}`;
}

function formatCompactNumber(value) {
  const count = Number(value || 0);
  if (count >= 1000) {
    const compact = Math.floor(count / 1000);
    return `${new Intl.NumberFormat("pt-BR").format(compact)}k`;
  }
  return new Intl.NumberFormat("pt-BR").format(count);
}

function formatListingRelativeTime(value) {
  const formatted = formatRelativeTime(value);
  return formatted === "agora" ? "Agora" : formatted;
}

async function recordListingView(postId) {
  if (!postId || !state.session?.access_token) return;
  try {
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${state.session.access_token}`,
    };
    const response = await fetch("/api/posts/listing-view", {
      method: "POST",
      headers,
      body: JSON.stringify({
        postId,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível registrar visualização.");
    const listingViewCount = Number(payload.listingViewCount || 0);
    posts = posts.map((post) => (
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

function renderPostActions(post) {
  const postId = escapeHtml(post.id);
  if (isMarketplacePost(post)) {
    return `
      <div class="post-action-bar post-action-bar--listing listing-card-meta">
        <span>${escapeHtml(formatListingRelativeTime(post.createdAt))}</span>
        ${renderPostMenu(post)}
      </div>
    `;
  }
  const commentButton = state.session?.user ? `
        <button class="post-action-button" type="button" data-post-comment-toggle data-post-id="${postId}">
          Comentar
        </button>
  ` : "";
  return `
    <div class="post-action-bar">
      <div class="post-comment-action">
        ${commentButton}
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

function getPostMediaItems(post) {
  const items = Array.isArray(post.mediaItems) ? post.mediaItems : [];
  if (items.length) return items.filter((item) => item?.url);
  return post.mediaUrl
    ? [{ url: post.mediaUrl, mediaType: post.mediaType }]
    : [];
}

function renderImageLightboxAttrs(post, alt) {
  const author = post.author || {};
  return [
    "data-image-lightbox",
    `data-image-alt="${escapeHtml(alt)}"`,
    `data-image-author-name="${escapeHtml(author.displayName || author.username || "Usuário Gimerr")}"`,
    `data-image-author-username="${escapeHtml(author.username || "")}"`,
    `data-image-author-avatar="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}"`,
    `data-image-body="${escapeHtml(post.body || post.text || "")}"`,
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
  const videoAdsAttr = post.type === "listing" ? ` data-video-ads="off"` : "";
  return `
    <div class="video-media" data-video-view-container data-post-id="${escapeHtml(post.id || "")}">
      <button class="video-lazy-button media-frame" type="button"${videoAdsAttr} data-video-post-id="${escapeHtml(post.id || "")}" data-video-src="${escapeHtml(item.url)}" data-video-type="${escapeHtml(item.mediaType || "video/mp4")}" ${poster ? `data-video-poster="${escapeHtml(poster)}"` : ""} aria-label="Reproduzir vídeo">
        ${poster ? `<img class="video-lazy-poster" src="${escapeHtml(poster)}" alt="">` : `<span class="video-lazy-empty">Vídeo</span>`}
        <span class="video-lazy-play" aria-hidden="true"></span>
      </button>
      <span class="video-view-counter" data-video-view-count data-post-id="${escapeHtml(post.id || "")}">${escapeHtml(formatVideoViewCount(post.videoViewCount))}</span>
    </div>
  `;
}

function renderListingMedia(post) {
  const items = getPostMediaItems(post);
  const firstImage = items.find((item) => item.mediaType?.startsWith("image/"));
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

function renderPostMedia(post) {
  if (isMarketplacePost(post)) return renderListingMedia(post);
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

function getListingRecommenders(details) {
  return (details?.recommenders || []).map((user) => ({
    id: user.recommender_id || user.id || "",
    display_name: user.display_name || "",
    username: user.username || "",
    avatar_url: user.avatar_url || "",
  })).filter((user) => user.id || user.username);
}

function renderListingRecommendationsControl(details, stats, authorId) {
  const recommenders = getListingRecommenders(details);
  const count = Number(stats?.recommendations_count || recommenders.length || 0);
  return `
    <button class="listing-seller-stat-button" type="button" data-listing-recommendations data-seller-id="${escapeHtml(authorId || "")}">
      ${escapeHtml(formatCountLabel(count, "recomendação", "recomendações"))}
    </button>
  `;
}

function ensureListingPeopleModal() {
  let modal = document.querySelector("#listing-people-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.id = "listing-people-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <section class="people-modal" role="dialog" aria-modal="true" aria-labelledby="listing-people-modal-title">
      <div class="modal-head">
        <h2 id="listing-people-modal-title">Recomendações</h2>
        <button class="ghost-icon" type="button" data-listing-people-close aria-label="Fechar">x</button>
      </div>
      <div class="people-list" data-listing-people-list></div>
    </section>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.target === modal || target?.closest("[data-listing-people-close]")) {
      modal.hidden = true;
    }
  });
  return modal;
}

async function openListingRecommendationsModal(authorId) {
  const details = await loadListingSellerDetails(authorId);
  const users = getListingRecommenders(details);
  const modal = ensureListingPeopleModal();
  const list = modal.querySelector("[data-listing-people-list]");
  list.innerHTML = users.length ? users.map((user) => `
    <a class="people-row" href="${getProfileUrl({ id: user.id, username: user.username })}">
      <div class="post-avatar">
        <img src="${escapeHtml(user.avatar_url || "./assets/avatar.svg")}" alt="">
      </div>
      <div>
        <strong>${escapeHtml(user.display_name || user.username || "Usuário Gimerr")}</strong>
        ${user.username ? `<span>@${escapeHtml(user.username)}</span>` : ""}
      </div>
    </a>
  `).join("") : `<div class="empty-state">Nenhum usuário por aqui.</div>`;
  modal.hidden = false;
  modal.querySelector("[data-listing-people-close]")?.focus();
}

function renderListingDetail(post, sellerDetails = null) {
  const listingData = getListingCardData(post);
  const game = post.game || getGame(post.gameId);
  const author = post.author || {};
  const sellerProfile = sellerDetails?.profile || {};
  const stats = sellerDetails?.stats || {};
  const sellerName = sellerProfile.display_name || author.displayName || author.username || "Vendedor Gimerr";
  const sellerUsername = sellerProfile.username || author.username || "";
  const sellerAvatar = sellerProfile.avatar_url || author.avatarUrl || "./assets/avatar.svg";
  const canMessageSeller = author.id && author.id !== state.currentProfile?.id;
  const items = listingData.items.filter((item) => item.name || item.price || item.priceLabel || item.mediaItem || item.previewUrl);
  const listingVideo = getPostMediaItems(post).find((item) => item.mediaType?.startsWith("video/"));
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
        ${renderPostMenu(post, { inListingDetail: true })}
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
          ${renderListingRecommendationsControl(sellerDetails, stats, author.id)}
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
  const [profileResult, statsResult, linksResult, recommendersResult] = await Promise.all([
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
    client
      .from("public_profile_recommenders")
      .select("recommender_id, display_name, username, avatar_url")
      .eq("profile_id", authorId),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (statsResult.error) throw statsResult.error;
  if (linksResult.error) throw linksResult.error;
  if (recommendersResult.error) throw recommendersResult.error;
  const details = {
    profile: profileResult.data || {},
    stats: statsResult.data || {},
    platformLinks: linksResult.data || [],
    recommenders: recommendersResult.data || [],
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
  const index = posts.findIndex((item) => String(item.id) === String(detailPost.id));
  if (index >= 0) {
    posts[index] = {
      ...posts[index],
      ...detailPost,
      author: {
        ...(posts[index].author || {}),
        ...(detailPost.author || {}),
      },
      game: {
        ...(posts[index].game || {}),
        ...(detailPost.game || {}),
      },
    };
    return posts[index];
  }
  return {
    ...fallbackPost,
    ...detailPost,
    author: {
      ...(fallbackPost?.author || {}),
      ...(detailPost.author || {}),
    },
    game: {
      ...(fallbackPost?.game || {}),
      ...(detailPost.game || {}),
    },
  };
}

function closeListingDetailModal() {
  if (!els.listingDetailModal) return;
  window.GimerrVideoPlayer?.stopAll?.(els.listingDetailContent);
  els.listingDetailModal.hidden = true;
  if (els.listingDetailContent) els.listingDetailContent.innerHTML = "";
  if (getListingRoutePostId()) {
    window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
  }
}

async function openListingDetail(postId) {
  const feedPost = posts.find((item) => String(item.id) === String(postId));
  if (!els.listingDetailModal || !els.listingDetailContent) return;
  if (feedPost && !isMarketplacePost(feedPost)) return;
  if (!state.session?.user) {
    window.location.assign("./sign-in.html");
    return;
  }
  els.listingDetailModal.hidden = false;
  els.listingDetailContent.innerHTML = `<div class="listing-detail-loading">Carregando anúncio...</div>`;
  try {
    let post = feedPost;
    if (!post) {
      const detailPost = await loadListingDetailPost(postId);
      if (!detailPost || !isMarketplacePost(detailPost)) {
        throw new Error("Anúncio não encontrado.");
      }
      post = mergeListingDetailPost(feedPost, detailPost);
    }
    recordListingView(postId);
    els.listingDetailContent.innerHTML = renderListingDetail(post, null);
    window.GimerrVideoPlayer?.prepare?.(els.listingDetailContent);
    const sellerDetails = await loadListingSellerDetails(post.author?.id);
    els.listingDetailContent.innerHTML = renderListingDetail(post, sellerDetails);
    window.GimerrVideoPlayer?.prepare?.(els.listingDetailContent);
  } catch (error) {
    console.warn("Não foi possível carregar detalhes do anúncio.", error);
    if (feedPost && isMarketplacePost(feedPost)) {
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

function renderCommentMedia(comment) {
  if (!comment?.mediaUrl || !String(comment.mediaType || "").startsWith("image/")) return "";
  const url = escapeHtml(comment.mediaUrl);
  return `
    <button class="comment-media-button" type="button" data-image-lightbox data-image-src="${url}" data-image-alt="Imagem do comentário">
      <img src="${url}" alt="Imagem do comentário">
    </button>
  `;
}

function renderCommentTools() {
  return `
    <div class="comment-emoji-picker" data-comment-emoji-picker hidden></div>
    <div class="comment-form-tools">
      <label class="comment-tool-button" title="Adicionar imagem">
        <img src="./assets/camera.svg.svg" alt="" aria-hidden="true">
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-comment-image>
      </label>
      <button class="comment-tool-button" type="button" data-comment-emoji aria-label="Abrir emojis"><img src="./assets/emoji.svg.svg" alt="" aria-hidden="true"></button>
    </div>
    <div class="comment-image-preview" data-comment-image-preview hidden></div>
  `;
}

function renderInlineCommentReplyForm(postId, comment) {
  if (String(state.replyingToCommentId) !== String(comment.id)) return "";
  if (!state.session?.user?.id || !state.session?.access_token) return "";
  const isSubmitting = String(state.commentSubmittingPostId) === String(comment.id);
  return `
    <form class="inline-comment-form inline-reply-form" data-inline-comment-form data-post-id="${escapeHtml(postId)}" data-parent-comment-id="${escapeHtml(comment.id)}">
      <textarea maxlength="500" rows="2" placeholder="Responder comentário">${getReplyMention(comment)}</textarea>
      <div class="composer-mention-suggestions comment-mention-suggestions" data-comment-mention-suggestions hidden></div>
      ${renderCommentTools()}
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
  const isAuthenticated = Boolean(state.session?.user?.id && state.session?.access_token);
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
          ${comment.body ? `<p>${renderTextWithMentions(comment.body, author.username)}</p>` : ""}
          ${renderCommentMedia(comment)}
          <div class="comment-actions">
            ${isAuthenticated ? `<button class="text-button comment-reply-button" type="button" data-comment-reply data-post-id="${escapeHtml(postId)}" data-comment-id="${escapeHtml(comment.id)}">Responder</button>` : ""}
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
      : `<p class="comments-empty">${
        isLoading
          ? "Carregando comentários..."
          : `Nenhum comentário ainda.${state.session?.user ? "" : ` <a class="comments-login-link" href="./sign-in.html">Entre para comentar</a>.`}`
      }</p>`;
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
  if (!state.session?.user?.id || !state.session?.access_token) return "";
  const isSubmitting = String(state.commentSubmittingPostId) === String(post.id);
  return `
    <form class="inline-comment-form" data-inline-comment-form data-post-id="${escapeHtml(post.id)}">
      <textarea maxlength="500" rows="2" placeholder="Escreva um comentário"></textarea>
      <div class="composer-mention-suggestions comment-mention-suggestions" data-comment-mention-suggestions hidden></div>
      ${renderCommentTools()}
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

function getCommentImageInput(form) {
  return form?.querySelector("[data-comment-image]") || null;
}

function getCommentImageFile(form) {
  return getCommentImageInput(form)?.files?.[0] || null;
}

function validateCommentImageFile(file) {
  if (!file) return "";
  if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type || "")) {
    return "Envie uma imagem JPG, PNG, WebP ou GIF.";
  }
  if (file.size > 5 * 1024 * 1024) {
    return "A imagem do comentário deve ter no máximo 5 MB.";
  }
  return "";
}

function setCommentImagePreview(form) {
  const preview = form?.querySelector("[data-comment-image-preview]");
  const file = getCommentImageFile(form);
  if (!preview) return;
  if (!file) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }
  const url = URL.createObjectURL(file);
  preview.hidden = false;
  preview.innerHTML = `
    <img src="${url}" alt="">
    <button type="button" data-comment-image-clear aria-label="Remover imagem">×</button>
  `;
  preview.querySelector("img")?.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
}

function clearCommentImage(form) {
  const input = getCommentImageInput(form);
  if (input) input.value = "";
  setCommentImagePreview(form);
}

async function uploadCommentMedia(form) {
  const file = getCommentImageFile(form);
  if (!file) return null;
  const validationMessage = validateCommentImageFile(file);
  if (validationMessage) throw new Error(validationMessage);
  const uploaded = await uploadComposerMedia(file, "comment");
  return {
    url: uploaded.url,
    key: uploaded.key,
    mediaType: uploaded.mediaType,
  };
}

function renderCommentEmojiPicker(form) {
  const picker = form?.querySelector("[data-comment-emoji-picker]");
  if (!picker) return null;
  if (!picker.innerHTML) {
    picker.innerHTML = `<emoji-picker class="gimerr-emoji-picker"></emoji-picker>`;
  }
  return picker;
}

function toggleCommentEmojiPicker(form) {
  const picker = renderCommentEmojiPicker(form);
  if (!picker) return;
  picker.hidden = !picker.hidden;
}

function insertTextInTextarea(textarea, text) {
  if (!textarea || !text) return;
  const value = textarea.value || "";
  const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : value.length;
  const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
  const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
  const maxLength = Number(textarea.maxLength || 0);
  if (maxLength > 0 && nextValue.length > maxLength) return;
  textarea.value = nextValue;
  const cursor = start + text.length;
  textarea.focus();
  textarea.setSelectionRange(cursor, cursor);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submitInlineComment(form) {
  const postId = form.dataset.postId || "";
  const parentCommentId = form.dataset.parentCommentId || "";
  const submitKey = parentCommentId || postId;
  const textarea = form.querySelector("textarea");
  const feedback = form.querySelector("[data-inline-comment-feedback]");
  const body = textarea?.value?.trim() || "";
  const imageFile = getCommentImageFile(form);
  if (!postId || (!body && !imageFile) || state.commentSubmittingPostId) {
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
    const media = await uploadCommentMedia(form);
    const response = await fetch("/api/posts/comments", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ postId, body, parentCommentId: parentCommentId || null, media }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível comentar.");

    posts = posts.map((post) => (
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
    textarea.value = "";
    clearCommentImage(form);
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
  posts = posts.map((post) => (
    String(post.id) === String(postId)
      ? { ...post, commentCount: Math.max(0, Number(post.commentCount || 0) - deletedCount) }
      : post
  ));
  if (deletedIds.map(String).includes(String(state.replyingToCommentId))) {
    state.replyingToCommentId = "";
  }
  renderFeed({ prepareVideos: false });
}

async function deletePost(postId) {
  if (!state.session?.access_token) return;
  const confirmed = window.confirm("Apagar este anúncio? Essa ação é irreversível.");
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

  posts = posts.filter((post) => String(post.id) !== String(postId));
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
  const post = posts.find((item) => String(item.id) === String(postId));
  if (!post || isMarketplacePost(post)) return;
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

  posts = posts.map((item) => (
    String(item.id) === String(postId)
      ? { ...item, body: payload.post?.body ?? String(body || "").trim() }
      : item
  ));
  state.editingPostId = "";
  state.editSubmittingPostId = "";
  renderFeed({ prepareVideos: false });
}

async function hydrateAuthenticatedHome() {
  try {
    const { data } = await window.GimerrAuth.getSession();
    if (!data.session?.user) {
      state.signedIn = false;
      state.session = null;
      cleanAuthUrl();
      return true;
    }

    state.signedIn = true;
    state.session = data.session;
    cleanAuthUrl();
    return true;
  } catch (error) {
    console.warn("Não foi possível carregar sessão do usuário.", error);
    state.signedIn = false;
    state.session = null;
    return true;
  }
}

async function loadFollowedGames() {
  if (!state.session?.user) {
    state.followedGames = [];
    return;
  }
  const client = await window.GimerrAuth.getClient();
  const { data, error } = await client
    .from("game_follows")
    .select("created_at, game:igdb_games(igdb_id, name, slug, cover_url)")
    .eq("profile_id", state.session.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) throw error;
  state.followedGames = (data || [])
    .map(normalizeFollowedGame)
    .filter((game) => game.id);
}

async function loadCurrentProfile() {
  if (!state.session?.user) {
    state.currentProfile = null;
    return;
  }

  const client = await window.GimerrAuth.getClient();
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .eq("id", state.session.user.id)
    .maybeSingle();

  if (error) throw error;
  state.currentProfile = data || null;
}

async function loadRecommendedProfiles() {
  if (!state.session?.user) {
    state.followedProfiles = [];
    return;
  }
  const client = await window.GimerrAuth.getClient();
  const { data: recommendations, error: recommendationsError } = await client
    .from("profile_recommendations")
    .select("recommended_id")
    .eq("recommender_id", state.session.user.id)
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

async function loadIndexSidebar({ append = false } = {}) {
  if (state.sidebarLoading) return;
  state.sidebarLoading = true;
  renderIndexSidebar();
  try {
    const offset = append ? state.sidebarOffset : 0;
    const params = new URLSearchParams({
      sidebar: "1",
      sidebarLimit: String(SIDEBAR_PAGE_SIZE),
      sidebarOffset: String(offset),
    });
    const response = await fetch(`/api/posts/feed?${params.toString()}`, {
      headers: {
        accept: "application/json",
        ...(state.session?.access_token ? { authorization: `Bearer ${state.session.access_token}` } : {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a sidebar.");

    state.sidebarMode = payload.mode || (state.signedIn ? "authenticated" : "guest");
    state.sidebarHasMore = Boolean(payload.hasMore);
    state.sidebarOffset = Number(payload.nextOffset || 0);
    const nextGames = (payload.games || [])
      .map((game) => normalizeFollowedGame({ game }))
      .filter((game) => game.id);
    state.followedGames = append ? [...state.followedGames, ...nextGames] : nextGames;
    const byId = new Map();
    state.followedGames.forEach((game) => {
      if (!byId.has(String(game.id))) byId.set(String(game.id), game);
    });
    state.followedGames = Array.from(byId.values());
  } finally {
    state.sidebarLoading = false;
  }
}

async function loadFeedPosts({ append = false } = {}) {
  if (state.feedLoading) return;
  const offset = append ? state.feedOffset : 0;
  state.feedLoading = true;
  try {
    const response = await fetch(`/api/posts/feed?limit=${state.feedPageSize}&offset=${offset}`, {
      headers: {
        accept: "application/json",
        ...(state.session?.access_token ? { authorization: `Bearer ${state.session.access_token}` } : {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (!append) posts = [];
      throw new Error(payload.error || "Não foi possível carregar o feed.");
    }
    const nextPosts = payload.posts || [];
    posts = append ? [...posts, ...nextPosts] : nextPosts;
    state.feedHasMore = Boolean(payload.hasMore);
    state.feedOffset = Number(payload.nextOffset || posts.length);
  } finally {
    state.feedLoading = false;
  }
}

function renderListingItems(nextItems = null) {
  if (!els.listingItems) return;
  if (Array.isArray(nextItems)) {
    state.listingItemDrafts = nextItems;
  } else {
    syncListingDraftsFromDom();
  }
  ensureListingDraftItems();
  const items = state.listingItemDrafts;
  const currency = getListingCurrency();
  const currencySymbol = currency ? (LISTING_CURRENCY_SYMBOLS[currency] || currency) : "Moeda";
  els.listingItems.innerHTML = items.map((item, index) => `
    <div class="listing-item-row" data-listing-item-row data-listing-item-id="${escapeHtml(item.id)}">
      <label>
        <span>Item</span>
        <input type="text" data-listing-item-name maxlength="60" placeholder="Nome do item" value="${escapeHtml(item.name)}">
      </label>
      <label>
        <span>Preço</span>
        <div class="price-input">
          <span>${escapeHtml(currencySymbol)}</span>
          <input type="number" data-listing-item-price min="0" step="0.01" inputmode="decimal" placeholder="0,00" value="${escapeHtml(item.price)}">
        </div>
      </label>
      <label class="listing-item-image-field">
        <span>Imagem (opcional)</span>
        <input type="file" data-listing-item-image accept="image/jpeg,image/png,image/webp,image/gif">
        <div class="listing-item-image-preview${item.previewUrl ? " has-image" : ""}">
          ${item.previewUrl ? `<img src="${escapeHtml(item.previewUrl)}" alt="">` : `<span>Selecionar imagem</span>`}
        </div>
      </label>
      <button class="ghost-icon listing-item-remove" type="button" data-listing-item-remove aria-label="${index === 0 ? "Limpar item" : "Remover item"}">x</button>
    </div>
  `).join("");
  updateListingItemAddButton(items.length);
}

function updateListingItemAddButton(itemCount = state.listingItemDrafts.length) {
  if (!els.listingItemAdd) return;
  const remaining = Math.max(0, 15 - Number(itemCount || 0));
  els.listingItemAdd.hidden = remaining <= 0;
  els.listingItemAdd.textContent = remaining === 1
    ? "Adicione mais 1 item"
    : `Adicione mais ${remaining} itens`;
}

function setComposerMode(mode) {
  state.composerMode = mode === "listing" ? "listing" : "post";
  const isListing = state.composerMode === "listing";
  els.composer?.classList.toggle("is-listing-mode", isListing);
  els.composer?.classList.remove("is-listing-blocked");
  els.composerModeButtons.forEach((button) => {
    const active = button.dataset.composerMode === state.composerMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  if (els.listingComposerFields) {
    els.listingComposerFields.hidden = false;
  }
  if (els.listingHelper) {
    showListingHelperMessage();
  }
  if (els.composerTitle) {
    els.composerTitle.textContent = isListing ? "Novo anúncio" : "Novo post";
  }
  if (els.composerText) {
    els.composerText.placeholder = isListing
      ? "Descreva seu anúncio: itens, condições de compra, troca, entrega ou outras informações importantes."
      : "Compartilhe uma jogada, chame a comunidade para jogar ou fale sobre o que você quiser.";
    els.composerText.maxLength = isListing ? 1200 : 220;
  }
  if (els.publishPost && !els.publishPost.disabled) {
    els.publishPost.textContent = isListing
      ? (state.editingListingPostId ? "Salvar anúncio" : "Publicar anúncio")
      : "Publicar post";
  }
  if (isListing && els.listingItems && !els.listingItems.children.length) {
    renderListingItems();
  }
  if (els.composerGameLabel) {
    els.composerGameLabel.textContent = isListing ? "Jogo do anúncio" : "Jogo relacionado";
  }
  if (els.composerFileHelper) {
    els.composerFileHelper.textContent = isListing ? "Opcional: 1 vídeo de até 3 minutos e 500 MB." : "";
    els.composerFileHelper.hidden = !isListing;
  }
  if (isListing) {
    setComposerEmojiPickerOpen(false);
  }
  if (state.composerSelectedFiles.length > 1) {
    clearComposerFile();
  }
  setVideoHelperMessage("");
  clearComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
  setComposerAvailability();
}

function setComposerAvailability() {
  getAvailableGames();
  const unavailable = false;
  els.composer?.classList.remove("is-listing-blocked");
  if (els.listingHelper) {
    showListingHelperMessage();
  }
  if (els.composerImageFile) {
    els.composerImageFile.accept = "image/jpeg,image/png,image/webp,image/gif";
    els.composerImageFile.multiple = false;
  }
  if (els.composerVideoFile) {
    els.composerVideoFile.accept = "video/mp4,video/webm,video/quicktime";
    els.composerVideoFile.multiple = false;
  }
  els.composerText.disabled = unavailable;
  if (els.composerGameSearch) els.composerGameSearch.disabled = unavailable || Boolean(state.editingListingPostId);
  if (els.composerImageFile) els.composerImageFile.disabled = unavailable || state.composerMode === "listing";
  if (els.composerVideoFile) els.composerVideoFile.disabled = unavailable;
  els.openComposer.disabled = false;
  els.composerModeButtons.forEach((button) => {
    button.disabled = unavailable;
  });
  if (els.listingCurrency) els.listingCurrency.disabled = unavailable;
  if (els.listingItemAdd) els.listingItemAdd.disabled = unavailable;
  els.listingItems?.querySelectorAll("input, button").forEach((field) => {
    field.disabled = unavailable;
  });

  els.composerText.placeholder = state.composerMode === "listing"
    ? "Descreva seu anúncio: itens, condições de compra, troca, entrega ou outras informações importantes."
    : "Compartilhe uma jogada, chame a comunidade para jogar ou fale sobre o que você quiser.";

  els.publishPost.disabled = false;
  els.publishPost.textContent = state.composerMode === "listing"
    ? (state.editingListingPostId ? "Salvar anúncio" : "Publicar anúncio")
    : "Publicar post";
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 820px)").matches;
}

function setComposerOpen(open) {
  if (!els.composer) return;
  els.composer.hidden = !open;
  els.composer.classList.toggle("is-mobile-open", open);
  document.body.classList.toggle("has-mobile-composer-open", open);
  if (els.openComposer) {
    els.openComposer.setAttribute("aria-expanded", String(open));
  }
}

function setMobileComposerOpen(open) {
  setComposerOpen(open);
}

function shouldOpenComposerFromRoute() {
  const url = new URL(window.location.href);
  return url.searchParams.get("openComposer") === "1" || url.hash === "#composer";
}

function clearComposerRouteFlag() {
  const url = new URL(window.location.href);
  const hadFlag = url.searchParams.has("openComposer") || url.hash === "#composer";
  if (!hadFlag) return;
  url.searchParams.delete("openComposer");
  if (url.hash === "#composer") url.hash = "";
  window.history.replaceState({}, "", url.toString());
}

function openComposerAndFocus() {
  setComposerMode("post");
  setComposerOpen(true);
  window.setTimeout(() => els.composerText?.focus(), 80);
}

function cancelListingEdit() {
  state.editingListingPostId = "";
  state.editingListingVideoItem = null;
  if (els.cancelListingEdit) els.cancelListingEdit.hidden = true;
  els.composerText.value = "";
  resetListingCurrency();
  resetListingItems();
  clearComposerFile();
  setComposerMode("listing");
  setComposerAvailability();
  setComposerOpen(false);
}

async function startListingEdit(postId) {
  let post = posts.find((item) => String(item.id) === String(postId));
  if (!post) {
    const detailPost = await loadListingDetailPost(postId).catch(() => null);
    if (detailPost && isMarketplacePost(detailPost)) {
      post = mergeListingDetailPost(null, detailPost);
      posts = [post, ...posts.filter((item) => String(item.id) !== String(post.id))];
    }
  }
  if (!post || !isMarketplacePost(post)) return;
  const ownerId = post.author?.id || post.profileId || post.profile_id || "";
  if (ownerId && state.session?.user?.id && String(ownerId) !== String(state.session.user.id)) {
    window.alert("Você só pode editar seus próprios anúncios.");
    return;
  }
  const parsed = parseListingBody(post.body || "", Array.isArray(post.mediaItems) ? post.mediaItems : getPostMediaItems(post));
  state.editingListingPostId = post.id;
  state.editingListingVideoItem = getPostMediaItems(post).find((item) => item.mediaType?.startsWith("video/")) || null;
  state.listingCurrency = parsed.currency;
  if (els.listingCurrency) els.listingCurrency.value = parsed.currency;
  setComposerMode("listing");
  els.composerText.value = parsed.description;
  state.listingItemDrafts.forEach(revokeListingPreview);
  state.listingItemDrafts = parsed.items;
  renderListingItems(state.listingItemDrafts);
  const game = post.game || getGame(post.gameId);
  if (game) selectComposerGame(game);
  else if (els.composerServer) els.composerServer.value = String(post.gameId || "");
  if (els.cancelListingEdit) els.cancelListingEdit.hidden = false;
  setComposerAvailability();
  setComposerOpen(true);
  els.composer.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => els.composerText.focus());
}

function formatSidebarCount(count, singular, plural) {
  const number = Number(count || 0);
  if (!number) return "";
  return `${formatCompactNumber(number)} ${number === 1 ? singular : plural}`;
}

function renderIndexSidebar() {
  if (!els.indexSidebar) return;
  els.sidebarGamesTitle.textContent = "Jogos em destaque";
  els.serverCount.textContent = String(state.followedGames.length);

  els.serverList.innerHTML = state.followedGames.length ? state.followedGames.map((game) => `
    <a class="server-item" href="${getGameUrl(game)}">
      <div class="server-logo">
        <img src="${escapeHtml(game.coverUrl || "./assets/avatar.svg")}" alt="">
      </div>
      <div class="server-copy">
        <strong>${escapeHtml(game.name)}</strong>
        <span class="server-meta">${escapeHtml(game.source === "followed" ? "Você segue" : (formatSidebarCount(game.count, "post recente", "posts recentes") || "Movimento recente"))}</span>
      </div>
    </a>
  `).join("") : `
    <p class="sidebar-empty">Os jogos mais movimentados aparecerão aqui.</p>
  `;
  if (state.sidebarHasMore || state.sidebarLoading) {
    els.serverList.insertAdjacentHTML("beforeend", `
      <div class="sidebar-pagination" data-sidebar-sentinel>
        ${state.sidebarLoading ? "Carregando..." : "Carregar mais jogos"}
      </div>
    `);
  }

  els.indexSidebar.hidden = false;
  observeSidebarSentinel();
}

function observeSidebarSentinel() {
  if (sidebarObserver) sidebarObserver.disconnect();
  const sentinel = els.serverList?.querySelector("[data-sidebar-sentinel]");
  if (!sentinel || !state.sidebarHasMore) return;

  sidebarObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    loadMoreSidebarGames().catch((error) => {
      console.warn("Não foi possível carregar mais jogos da sidebar.", error);
    });
  }, {
    root: window.matchMedia("(min-width: 1121px)").matches ? els.indexSidebar : null,
    rootMargin: "260px 0px",
    threshold: 0.01,
  });
  sidebarObserver.observe(sentinel);
}

async function loadMoreSidebarGames() {
  if (state.sidebarLoading || !state.sidebarHasMore) return;
  await loadIndexSidebar({ append: true });
  renderIndexSidebar();
}

function renderLiveStack() {
  const followedIds = new Set(state.followedGames.map((game) => String(game.id)));
  const active = state.liveUpdates.filter((update) => followedIds.has(String(update.gameId)));
  els.livePanel.hidden = active.length === 0;

  if (!active.length) {
    els.liveStack.innerHTML = "";
    return;
  }

  els.liveStack.innerHTML = active.map((update) => {
    const game = getGame(update.gameId);
    return `
      <div class="live-item">
        <div>
          <strong>${escapeHtml(game?.name || update.title || "Atualização ao vivo")}</strong>
          <span>${escapeHtml(update.label || "Ao vivo agora")}</span>
        </div>
        <span class="live-dot" aria-hidden="true"></span>
      </div>
    `;
  }).join("");
}

function renderFeedLoading() {
  window.GimerrVideoPlayer?.stopAll?.(els.feedList);
  els.feedList.innerHTML = `
    <article class="post-card feed-skeleton" aria-label="Carregando feed"></article>
    <article class="post-card feed-skeleton" aria-label="Carregando feed"></article>
  `;
}

function isMarketplacePost(post) {
  return post?.type === "listing";
}

function getPostTime(post) {
  const time = Date.parse(post?.createdAt || "");
  return Number.isFinite(time) ? time : 0;
}

function countNewPostsForFilter(filter) {
  const followedIds = new Set(state.followedGames.map((game) => String(game.id)));
  const recommendedProfileIds = new Set(state.followedProfiles.map((profile) => String(profile.id)));
  const seenTime = Date.parse(state.filterSeenAt[filter] || "") || 0;
  return posts.filter((post) => {
    const matchesFollowedGame = followedIds.has(String(post.gameId));
    const matchesRecommendedProfile = recommendedProfileIds.has(String(post.author?.id));
    const matchesFollowedSource = matchesFollowedGame || matchesRecommendedProfile;
    if (getPostTime(post) <= seenTime) return false;
    if (filter === "all") return matchesFollowedSource && !isMarketplacePost(post);
    if (filter === "listing") return matchesFollowedSource && isMarketplacePost(post);
    return false;
  }).length;
}

function renderFilterCounts() {
  els.filterCounts.forEach((badge) => {
    const filter = badge.dataset.filterCount;
    const count = countNewPostsForFilter(filter);
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.hidden = count <= 0 || state.filter === filter;
  });
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function renderPostTextBlock(post, textHtml) {
  if (isMarketplacePost(post)) {
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

function renderMarketplaceAdAfter(index, total) {
  if (total < 1) return "";
  const position = index + 1;
  const interval = 10;
  const firstAdPosition = total < interval ? Math.max(1, Math.ceil(total / 2)) : interval;
  const shouldInsert = position === firstAdPosition || (position > firstAdPosition && (position - firstAdPosition) % interval === 0);
  if (!shouldInsert) return "";
  return window.GimerrAdcashAds?.renderMarketplaceAdCard?.() || "";
}

function renderFeed({ prepareVideos = true } = {}) {
  window.GimerrVideoPlayer?.stopAll?.(els.feedList);
  const query = state.search.trim().toLowerCase();
  const marketplaceQuery = state.marketplaceSearch.trim().toLowerCase();
  const isListingFilter = state.filter === "listing";
  if (els.marketplaceSearchWrap) {
    els.marketplaceSearchWrap.hidden = !isListingFilter;
  }
  els.feedList?.classList.toggle("is-marketplace-grid", isListingFilter);
  const filtered = posts.filter((post) => {
    const isListing = isMarketplacePost(post);
    if (isListingFilter ? !isListing : isListing) return false;
    const game = post.game || getGame(post.gameId);
    const matchesSearch = !query || [post.body, game?.name, post.author?.displayName, post.author?.username]
      .join(" ")
      .toLowerCase()
      .includes(query);
    const matchesMarketplaceSearch = !marketplaceQuery || [
      post.body,
      game?.name,
      post.author?.displayName,
      post.author?.username,
    ].join(" ").toLowerCase().includes(marketplaceQuery);
    return matchesSearch && (!isListingFilter || matchesMarketplaceSearch);
  });
  els.feedList?.classList.toggle("is-empty", !filtered.length);

  if (!filtered.length && state.feedLoading) {
    renderFeedLoading();
    renderFilterCounts();
    return;
  }

  if (!filtered.length) {
    const loaderHtml = state.feedHasMore
      ? `
        <div class="post-card empty-state">
          ${isListingFilter ? "Nenhum anúncio por aqui ainda." : "Nada novo por aqui."}
          <button class="text-button" type="button" data-feed-load-more ${state.feedLoading ? "disabled" : ""}>
            ${state.feedLoading ? "Carregando..." : "Carregar mais"}
          </button>
        </div>
      `
      : `<div class="post-card empty-state">${isListingFilter ? "Nenhum anúncio por aqui ainda." : "Nada novo por aqui."}</div>`;
    els.feedList.innerHTML = loaderHtml;
    renderFilterCounts();
    return;
  }

  const feedHtml = filtered.map((post, index) => {
    const game = post.game || getGame(post.gameId);
    const author = post.author || {};
    const authorName = author.displayName || "Usuário Gimerr";
    const authorHandle = author.username ? `@${author.username}` : "@gimerr";
    const media = renderPostMedia(post);
    const listingData = isMarketplacePost(post) ? getListingCardData(post) : null;
    const bodyText = listingData
      ? getListingPreviewText(listingData)
      : post.body;
    const isListing = isMarketplacePost(post);
    const cardHtml = `
      <article class="post-card${isListing ? " marketplace-post-card" : ""}">
        ${media}
        <div class="post-body">
          ${isListing ? "" : renderMentionLine(authorName, post)}
          ${isListing ? "" : `
            <div class="post-meta">
              <a class="author-block" href="${getProfileUrl(author)}">
                <div class="post-avatar">
                  <img src="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}" alt="">
                </div>
                <div class="author-copy">
                  <strong>${escapeHtml(authorName)}</strong>
                  <span>${escapeHtml(authorHandle)}</span>
                </div>
              </a>
              <div class="post-card-tools">
                ${renderPostMenu(post)}
              </div>
            </div>
          `}
          <div>
            ${renderPostTextBlock(post, bodyText ? escapeHtml(bodyText) : "")}
          </div>
          <a class="channel-line" href="${getGameUrl(game)}">
            <span class="channel-game-logo" aria-hidden="true">
              <img src="${escapeHtml(game?.coverUrl || "./assets/avatar.svg")}" alt="">
            </span>
            <span>Em ${escapeHtml(game?.name || "Game")}</span>
          </a>
          ${renderPostActions(post)}
        </div>
      </article>
    `;
    return `${cardHtml}${isListingFilter && isListing ? renderMarketplaceAdAfter(index, filtered.length) : ""}`;
  }).join("");
  const loaderHtml = state.feedHasMore
    ? `
      <div class="feed-pagination" data-feed-sentinel>
        <button class="text-button" type="button" data-feed-load-more ${state.feedLoading ? "disabled" : ""}>
          ${state.feedLoading ? "Carregando mais..." : "Carregar mais"}
        </button>
      </div>
    `
    : "";
  els.feedList.innerHTML = `${feedHtml}${loaderHtml}`;
  if (prepareVideos) window.GimerrVideoPlayer?.prepare(els.feedList);
  if (isListingFilter) window.GimerrAdcashAds?.prepareMarketplaceAds?.(els.feedList);
  renderFilterCounts();
  observeFeedSentinel();
}

function observeFeedSentinel() {
  if (feedObserver) feedObserver.disconnect();
  const sentinel = els.feedList.querySelector("[data-feed-sentinel]");
  if (!sentinel || !state.feedHasMore) return;
  if (!("IntersectionObserver" in window)) return;

  feedObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    loadMoreFeedPosts().catch((error) => {
      console.warn("Não foi possível carregar mais posts.", error);
    });
  }, {
    rootMargin: "900px 0px",
    threshold: 0.01,
  });
  feedObserver.observe(sentinel);
}

async function loadMoreFeedPosts() {
  if (state.feedLoading || !state.feedHasMore) return;
  await loadFeedPosts({ append: true });
  renderFeed();
}

function setFilter(nextFilter) {
  window.GimerrVideoPlayer?.stopAll?.(els.feedList);
  const filter = nextFilter === "listing" ? "listing" : "all";
  state.filter = filter;
  if (Object.prototype.hasOwnProperty.call(state.filterSeenAt, filter)) {
    state.filterSeenAt[filter] = new Date().toISOString();
  }
  els.filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === filter);
  });
  renderFilterCounts();
  renderFeed();
}

async function prepareComposerUploadFile(file, type) {
  if (!file) return null;
  if (!validateComposerFile(file)) return null;
  return file;
}

async function uploadComposerMedia(file, target) {
  if (!file) return null;
  if (target === "video") {
    const signedResponse = await fetch("/api/post-media-upload-url", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        target,
        fileName: file.name,
        mediaType: file.type,
        size: file.size,
      }),
    });
    const signedPayload = await signedResponse.json().catch(() => ({}));
    if (!signedResponse.ok) {
      const error = new Error(signedPayload.error || "Não foi possível preparar o envio do vídeo.");
      error.code = signedPayload.code;
      error.discordLinked = signedPayload.discordLinked;
      error.verificationStatus = signedPayload.verificationStatus;
      throw error;
    }

    const uploadResponse = await fetch(signedPayload.uploadUrl, {
      method: "PUT",
      headers: signedPayload.headers || { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!uploadResponse.ok) {
      throw new Error(`Falha ao enviar vídeo para o storage (${uploadResponse.status}).`);
    }

    return {
      key: signedPayload.key,
      url: signedPayload.url,
      mediaType: signedPayload.mediaType,
    };
  }

  const formData = new FormData();
  formData.append("target", target);
  formData.append("file", file);

  const response = await fetch("/api/post-media-upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.session.access_token}`,
    },
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível enviar a mídia.");
    error.code = payload.code;
    error.discordLinked = payload.discordLinked;
    error.verificationStatus = payload.verificationStatus;
    throw error;
  }
  return payload;
}

async function uploadComposerMediaItems(files, target) {
  if (!files.length) return [];
  const uploadedItems = [];
  for (let index = 0; index < files.length; index += 1) {
    const uploaded = await uploadComposerMedia(files[index], target);
    uploadedItems.push({
      url: uploaded.url,
      key: uploaded.key,
      mediaType: uploaded.mediaType,
    });
  }
  return uploadedItems;
}

async function createFeedPost({ game, type, text, uploadedMediaItems }) {
  const primaryMedia = uploadedMediaItems?.find((item) => item?.url && item?.key) || null;
  const response = await fetch("/api/posts/create", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      gameId: game.id,
      type,
      body: text,
      mediaUrl: primaryMedia?.url || null,
      mediaKey: primaryMedia?.key || null,
      mediaType: primaryMedia?.mediaType || null,
      mediaItems: type === "listing" ? uploadedMediaItems : [],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível publicar.");
    error.code = payload.code;
    error.discordLinked = payload.discordLinked;
    error.verificationStatus = payload.verificationStatus;
    throw error;
  }
  return payload.post;
}

async function buildListingMediaItemsForSave(items, videoFiles = []) {
  const uploadedItems = [];
  let uploadIndex = 0;
  const newFilesCount = items.filter((item) => item.file).length;
  for (const [position, item] of items.entries()) {
    const baseItem = {
      itemName: item.name,
      priceLabel: item.priceLabel || formatListingPrice(item.price),
      position,
    };
    if (item.file) {
      uploadIndex += 1;
      const uploaded = await uploadComposerMedia(item.file, "listing");
      uploadedItems.push({
        ...baseItem,
        url: uploaded.url,
        key: uploaded.key,
        mediaType: uploaded.mediaType,
      });
    } else if (item.mediaItem?.url && item.mediaItem?.key) {
      uploadedItems.push({
        ...baseItem,
        url: item.mediaItem.url,
        key: item.mediaItem.key,
        mediaType: item.mediaItem.mediaType || "image/jpeg",
      });
    } else {
      uploadedItems.push(baseItem);
    }
  }
  if (videoFiles.length) {
    const uploaded = await uploadComposerMedia(videoFiles[0], "video");
    const thumbnailFile = await createVideoThumbnailFile(videoFiles[0]);
    const thumbnail = await uploadComposerMedia(thumbnailFile, "video-thumbnail");
    uploadedItems.push({
      url: uploaded.url,
      key: uploaded.key,
      mediaType: uploaded.mediaType,
      mediaRole: "listingVideo",
      thumbnailUrl: thumbnail.url,
      thumbnailKey: thumbnail.key,
    });
  } else if (state.editingListingVideoItem?.url && state.editingListingVideoItem?.key) {
    uploadedItems.push(state.editingListingVideoItem);
  }
  return uploadedItems;
}

async function updateFeedListing({ postId, text, uploadedMediaItems }) {
  const primaryMedia = uploadedMediaItems?.[0] || null;
  const response = await fetch("/api/posts/update", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      postId,
      body: text,
      mediaUrl: primaryMedia?.url || null,
      mediaKey: primaryMedia?.key || null,
      mediaType: primaryMedia?.mediaType || null,
      mediaItems: uploadedMediaItems,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível salvar o anúncio.");
    error.code = payload.code;
    throw error;
  }
  return payload.post;
}

function setPublishing(isPublishing, label = "Publicar") {
  const unavailable = false;
  els.publishPost.disabled = isPublishing || unavailable;
  els.publishPost.textContent = isPublishing
    ? label
    : (state.composerMode === "listing"
      ? (state.editingListingPostId ? "Salvar anúncio" : "Publicar anúncio")
      : "Publicar post");
  els.composerText.disabled = isPublishing || unavailable;
  if (els.composerGameSearch) els.composerGameSearch.disabled = isPublishing || unavailable || Boolean(state.editingListingPostId);
  if (els.composerImageFile) els.composerImageFile.disabled = isPublishing || unavailable || state.composerMode === "listing";
  if (els.composerVideoFile) els.composerVideoFile.disabled = isPublishing || unavailable;
  els.composerModeButtons.forEach((button) => {
    button.disabled = isPublishing || unavailable;
  });
  if (els.listingCurrency) els.listingCurrency.disabled = isPublishing || unavailable;
  if (els.listingItemAdd) els.listingItemAdd.disabled = isPublishing || unavailable;
  if (els.cancelListingEdit) els.cancelListingEdit.disabled = isPublishing;
  els.listingItems?.querySelectorAll("input, button").forEach((field) => {
    field.disabled = isPublishing || unavailable;
  });
}

async function publishPost() {
  if (!state.session?.access_token) {
    window.location.assign("./sign-in.html");
    return;
  }

  const text = els.composerText.value.trim();
  const type = getPostTypeFromComposer(state.composerSelectedFiles);
  const listingItems = type === "listing" ? getListingItemsFromComposer() : [];
  const itemImageFiles = listingItems.map((item) => item.file).filter(Boolean);
  const videoFiles = state.composerSelectedFiles;
  const files = type === "listing" ? [...itemImageFiles, ...videoFiles] : videoFiles;
  const finalText = type === "listing" ? buildListingBody(text, listingItems) : text;

  if (type === "listing" && !validateListingCurrency()) return;

  if (type === "listing" && !validateListingItems(listingItems)) return;

  if (!finalText && !files.length) {
    els.composerText.focus();
    return;
  }

  const game = getGame(els.composerServer.value) || state.composerSelectedGame;
  if (!game) {
    if (type === "listing") {
      showListingHelperMessage("Selecione um jogo para publicar o anúncio.", "warning");
    } else {
      showListingHelperMessage("Selecione um jogo para publicar o post.", "warning");
    }
    markComposerInvalid(els.composerGameSearch?.hidden ? els.composerGameSelected : els.composerGameSearch);
    els.composerGameSearch?.focus();
    return;
  }

  if (type === "listing" && !validateListingItemImageFiles(itemImageFiles)) return;
  if (!validateComposerFiles(videoFiles, type)) return;
  if (type === "listing" && !await validateListingVideoDuration(videoFiles)) return;

  try {
    setPublishing(true, "Publicando...");
    let uploadedMediaItems = [];
    if (type === "listing") {
      uploadedMediaItems = await buildListingMediaItemsForSave(listingItems, videoFiles);
    } else {
      const preparedFiles = [];
      for (const file of files) {
        const preparedFile = await prepareComposerUploadFile(file, type);
        if (!preparedFile) return;
        preparedFiles.push(preparedFile);
      }
      uploadedMediaItems = await uploadComposerMediaItems(preparedFiles, type);
    }
    if (state.editingListingPostId) {
      await updateFeedListing({ postId: state.editingListingPostId, text: finalText, uploadedMediaItems });
    } else {
      await createFeedPost({ game, type, text: finalText, uploadedMediaItems });
    }
    els.composerText.value = "";
    state.editingListingPostId = "";
    state.editingListingVideoItem = null;
    if (els.cancelListingEdit) els.cancelListingEdit.hidden = true;
    if (type === "listing") {
      resetListingCurrency();
      resetListingItems();
    }
    clearComposerFile();
    if (type !== "listing") {
      showListingHelperMessage();
      clearComposerGameSelection();
    }
    setComposerOpen(false);
    state.feedOffset = 0;
    state.feedHasMore = true;
    await loadFeedPosts();
    renderFeed();
  } catch (error) {
    console.warn("Não foi possível publicar.", error);
    window.alert(error.message || "Não foi possível publicar.");
  } finally {
    setPublishing(false);
  }
}

function getFileSignature(file) {
  return [file.name, file.size, file.lastModified, file.type].join(":");
}

function revokeComposerPreviewUrls() {
  state.composerPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  state.composerPreviewUrls = [];
}

function getComposerFiles() {
  return state.composerSelectedFiles;
}

function addComposerSelectedFiles(files) {
  state.composerSelectedFiles = Array.from(files || []).slice(0, 1);
}

async function renderComposerFile() {
  const selectedFiles = [
    ...Array.from(els.composerImageFile?.files || []),
    ...Array.from(els.composerVideoFile?.files || []),
  ];
  if (selectedFiles.length) addComposerSelectedFiles(selectedFiles);
  if (els.composerImageFile) els.composerImageFile.value = "";
  if (els.composerVideoFile) els.composerVideoFile.value = "";

  const files = getComposerFiles();
  if (!files.length) {
    els.composerMedia.hidden = true;
    els.composerFileName.textContent = "";
    if (els.composerMediaPreviews) els.composerMediaPreviews.innerHTML = "";
    state.preparedMediaFile = null;
    return;
  }

  const type = getPostTypeFromComposer(files);
  if (!validateComposerFiles(files, type)) {
    clearComposerFile({ preserveVideoHelper: true });
    return;
  }
  if (type === "listing" && !await validateListingVideoDuration(files)) {
    clearComposerFile({ preserveVideoHelper: true });
    return;
  }

  revokeComposerPreviewUrls();
  els.composerMedia.hidden = false;
  els.composerFileName.textContent = files.length === 1
    ? files[0].name
    : `${files.length} imagens selecionadas`;
  if (els.composerMediaPreviews) {
    const imageFiles = files.filter(isImageFile).slice(0, 15);
    state.composerPreviewUrls = imageFiles.map((file) => URL.createObjectURL(file));
    els.composerMediaPreviews.innerHTML = state.composerPreviewUrls
      .map((url, index) => `
        <figure class="composer-media-preview">
          <img src="${escapeHtml(url)}" alt="Imagem selecionada ${index + 1}">
        </figure>
      `)
      .join("");
  }
  state.preparedMediaFile = null;
}

function clearComposerFile(options = {}) {
  revokeComposerPreviewUrls();
  state.composerSelectedFiles = [];
  if (els.composerImageFile) els.composerImageFile.value = "";
  if (els.composerVideoFile) els.composerVideoFile.value = "";
  els.composerMedia.hidden = true;
  els.composerFileName.textContent = "";
  if (els.composerMediaPreviews) els.composerMediaPreviews.innerHTML = "";
  state.preparedMediaFile = null;
  if (!options.preserveVideoHelper) {
    setVideoHelperMessage("");
    clearComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
  }
}

els.filterButtons.forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
});

els.search?.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderFeed();
});

els.marketplaceSearch?.addEventListener("input", (event) => {
  state.marketplaceSearch = event.target.value;
  renderFeed();
});

els.composerModeButtons.forEach((button) => {
  button.addEventListener("click", () => setComposerMode(button.dataset.composerMode));
});

els.listingCurrency?.addEventListener("change", (event) => {
  showListingHelperMessage();
  clearComposerInvalid(els.listingCurrency);
  syncListingDraftsFromDom();
  state.listingCurrency = event.target.value || "";
  renderListingItems(state.listingItemDrafts);
});

els.listingItemAdd?.addEventListener("click", () => {
  showListingHelperMessage();
  const items = getListingDraftItems();
  if (items.length >= 15) return;
  items.push(createListingDraftItem());
  renderListingItems(items);
});

els.listingItems?.addEventListener("click", (event) => {
  const removeButton = event.target instanceof Element
    ? event.target.closest("[data-listing-item-remove]")
    : null;
  if (!removeButton) return;
  showListingHelperMessage();
  const row = removeButton.closest("[data-listing-item-row]");
  if (!row) return;
  syncListingDraftsFromDom();
  const removedId = row.dataset.listingItemId || "";
  const itemIndex = state.listingItemDrafts.findIndex((item) => String(item.id) === String(removedId));
  if (itemIndex < 0) return;
  const removed = state.listingItemDrafts[itemIndex];
  revokeListingPreview(removed);
  if (itemIndex === 0) {
    state.listingItemDrafts[itemIndex] = createListingDraftItem({ id: removed.id });
  } else {
    state.listingItemDrafts.splice(itemIndex, 1);
  }
  renderListingItems(state.listingItemDrafts);
});

els.listingItems?.addEventListener("change", (event) => {
  const input = event.target instanceof Element
    ? event.target.closest("[data-listing-item-image]")
    : null;
  if (!input) return;
  showListingHelperMessage();
  const row = input.closest("[data-listing-item-row]");
  const file = input.files?.[0] || null;
  if (!row || !file) return;
  if (!isImageFile(file)) {
    showListingHelperMessage("As imagens dos itens precisam ser JPG, PNG, WebP ou GIF.", "warning");
    markComposerInvalid(input.closest(".listing-item-image-preview"));
    input.value = "";
    return;
  }
  syncListingDraftsFromDom();
  const item = state.listingItemDrafts.find((draft) => String(draft.id) === String(row.dataset.listingItemId || ""));
  if (!item) return;
  revokeListingPreview(item);
  item.file = file;
  item.mediaItem = null;
  item.previewUrl = URL.createObjectURL(file);
  item.previewObjectUrl = true;
  renderListingItems(state.listingItemDrafts);
});

els.listingItems?.addEventListener("input", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest("[data-listing-item-row]")) return;
  showListingHelperMessage();
  clearComposerFieldInvalidState(target);
});

els.composerText?.addEventListener("input", () => {
  if (state.composerMode === "listing") showListingHelperMessage();
  updateMentionSuggestions();
});
els.composerText?.addEventListener("click", updateMentionSuggestions);
els.composerText?.addEventListener("keyup", (event) => {
  if (["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) return;
  updateMentionSuggestions();
});
els.composerText?.addEventListener("keydown", (event) => {
  if (!state.mention.active || !state.mention.items.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.mention.selectedIndex = (state.mention.selectedIndex + 1) % state.mention.items.length;
    renderMentionSuggestions();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    state.mention.selectedIndex = (state.mention.selectedIndex - 1 + state.mention.items.length) % state.mention.items.length;
    renderMentionSuggestions();
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    insertMention(state.mention.items[state.mention.selectedIndex]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeMentionSuggestions();
  }
});

document.addEventListener("keydown", async (event) => {
  if (event.key === "Escape" && els.composerEmojiPicker && !els.composerEmojiPicker.hidden) {
    setComposerEmojiPickerOpen(false);
    return;
  }
  if (event.key === "Escape" && !els.listingDetailModal?.hidden) {
    closeListingDetailModal();
    return;
  }
  if ((event.key === "Enter" || event.key === " ") && event.target instanceof Element) {
    const listingCard = event.target.closest("[data-listing-open]");
    if (listingCard && event.target === listingCard && !listingCard.matches("button, a")) {
      event.preventDefault();
      await openListingDetail(listingCard.dataset.postId || "");
    }
  }
});

els.composerMentionSuggestions?.addEventListener("mousedown", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-mention-index]")
    : null;
  if (!button) return;
  event.preventDefault();
  const profile = state.mention.items[Number(button.dataset.mentionIndex || 0)];
  insertMention(profile);
});

els.composerEmojiButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  setComposerEmojiPickerOpen(els.composerEmojiPicker?.hidden);
});

els.composerEmojiPicker?.addEventListener("emoji-click", (event) => {
  insertComposerEmoji(event.detail?.unicode || event.detail?.emoji?.unicode || "");
});

els.publishPost?.addEventListener("click", publishPost);
function handleComposerFileChange() {
  renderComposerFile().catch((error) => {
    console.warn("Não foi possível validar o arquivo selecionado.", error);
    setVideoHelperMessage("Não foi possível validar o arquivo selecionado. Tente outro arquivo.", "warning");
    markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
    clearComposerFile({ preserveVideoHelper: true });
  });
}
els.composerImageFile?.addEventListener("change", handleComposerFileChange);
els.composerVideoFile?.addEventListener("change", handleComposerFileChange);
els.composer?.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types?.includes("Files")) return;
  event.preventDefault();
  els.composer.classList.add("is-dragging-file");
});
els.composer?.addEventListener("dragleave", (event) => {
  if (event.relatedTarget && els.composer.contains(event.relatedTarget)) return;
  els.composer.classList.remove("is-dragging-file");
});
els.composer?.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  event.preventDefault();
  els.composer.classList.remove("is-dragging-file");
  addComposerSelectedFiles(files);
  renderComposerFile().catch((error) => {
    console.warn("Não foi possível validar o arquivo arrastado.", error);
    setVideoHelperMessage("Não foi possível validar o arquivo arrastado. Tente outro arquivo.", "warning");
    markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
    clearComposerFile({ preserveVideoHelper: true });
  });
});
els.composerClearFile?.addEventListener("click", clearComposerFile);
els.cancelListingEdit?.addEventListener("click", cancelListingEdit);
els.listingDetailModal?.addEventListener("click", (event) => {
  if (event.target === els.listingDetailModal) closeListingDetailModal();
});
els.verificationClose?.addEventListener("click", closeVerificationModal);
els.verificationSteps?.addEventListener("click", async (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-verification-action]")
    : null;
  if (!button) return;

  try {
    if (button.dataset.verificationAction === "open_invite") {
      const invite = button.dataset.invite || "";
      if (!invite) throw new Error("Convite do servidor oficial ainda não configurado.");
      window.open(invite, "_blank", "noopener");
    } else if (button.dataset.verificationAction === "connect") {
      const isAlreadyConnected = button.dataset.discordLinked === "true"
        || button.textContent.toLowerCase().includes("discord conectado");
      if (isAlreadyConnected) {
        setVerificationFeedback("Discord já conectado. Continue pelo servidor oficial do Gimerr.", "success");
        return;
      }
      await startDiscordVerification();
    }
  } catch (error) {
    setVerificationFeedback(error.message || "Não foi possível continuar a verificação.", "error");
  }
});
els.verificationPrimary?.addEventListener("click", async () => {
  try {
    const action = els.verificationPrimary.dataset.action || "connect";
    if (action === "open_invite") {
      const invite = els.verificationPrimary.dataset.invite || "";
      if (!invite) throw new Error("Convite do servidor oficial ainda não configurado.");
      window.open(invite, "_blank", "noopener");
    }
  } catch (error) {
    setVerificationFeedback(error.message || "Não foi possível continuar a verificação.", "error");
  }
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

  const ignoreButton = target.closest("[data-user-ignore]");
  if (ignoreButton) {
    event.preventDefault();
    closePostMenus();
    try {
      await ignoreUser(ignoreButton.dataset.profileId || "");
    } catch (error) {
      console.warn("Não foi possível ignorar usuário.", error);
      window.alert(error.message || "Não foi possível ignorar este usuário.");
    }
    return;
  }

  const editListingButton = target.closest("[data-listing-edit]");
  if (editListingButton) {
    event.preventDefault();
    closePostMenus();
    closeListingDetailModal();
    await startListingEdit(editListingButton.dataset.postId || "");
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

  const listingRecommendationsButton = target.closest("[data-listing-recommendations]");
  if (listingRecommendationsButton) {
    event.preventDefault();
    closePostMenus();
    await openListingRecommendationsModal(listingRecommendationsButton.dataset.sellerId || "");
    return;
  }

  const listingCard = target.closest("[data-listing-open]");
  if (listingCard) {
    event.preventDefault();
    closePostMenus();
    await openListingDetail(listingCard.dataset.postId || "");
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

  const feedLoadMoreButton = target.closest("[data-feed-load-more]");
  if (feedLoadMoreButton) {
    event.preventDefault();
    await loadMoreFeedPosts();
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

  if (!target.closest("#composer-emoji-picker") && !target.closest("#composer-emoji-button")) {
    setComposerEmojiPickerOpen(false);
  }

  const commentEmojiButton = target.closest("[data-comment-emoji]");
  if (commentEmojiButton) {
    event.preventDefault();
    event.stopPropagation();
    toggleCommentEmojiPicker(commentEmojiButton.closest("[data-inline-comment-form]"));
    return;
  }

  const commentImageClear = target.closest("[data-comment-image-clear]");
  if (commentImageClear) {
    event.preventDefault();
    clearCommentImage(commentImageClear.closest("[data-inline-comment-form]"));
    return;
  }

  if (!target.closest("[data-comment-emoji-picker]") && !target.closest("[data-comment-emoji]")) {
    document.querySelectorAll("[data-comment-emoji-picker]:not([hidden])").forEach((picker) => {
      picker.hidden = true;
    });
  }

  if (!target.closest("#composer")) {
    closeMentionSuggestions();
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

document.addEventListener("change", (event) => {
  const input = event.target instanceof Element ? event.target.closest("[data-comment-image]") : null;
  if (!input) return;
  const form = input.closest("[data-inline-comment-form]");
  const feedback = form?.querySelector("[data-inline-comment-feedback]");
  const message = validateCommentImageFile(input.files?.[0] || null);
  if (message) {
    if (feedback) {
      feedback.textContent = message;
      feedback.className = "field-feedback is-error";
    }
    clearCommentImage(form);
    return;
  }
  if (feedback) {
    feedback.textContent = "";
    feedback.className = "field-feedback";
  }
  setCommentImagePreview(form);
});

document.addEventListener("emoji-click", (event) => {
  const picker = event.target instanceof Element ? event.target.closest("[data-comment-emoji-picker]") : null;
  if (!picker) return;
  const form = picker.closest("[data-inline-comment-form]");
  insertTextInTextarea(form?.querySelector("textarea"), event.detail?.unicode || event.detail?.emoji?.unicode || "");
});

document.addEventListener("click", (event) => {
  const textarea = event.target instanceof Element ? event.target.closest("[data-inline-comment-form] textarea") : null;
  if (textarea) {
    updateCommentMentionSuggestions(textarea);
    return;
  }
  if (!event.target.closest?.("[data-comment-mention-suggestions]")) {
    closeCommentMentionSuggestions();
  }
  if (!event.target.closest?.(".composer-game-field")) {
    hideComposerGameSuggestions();
  }
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
  if (event.key === "Escape") closeCommentMentionSuggestions();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePostMenus();
    closeMentionSuggestions();
    hideComposerGameSuggestions();
    setComposerOpen(false);
    if (!els.verificationModal.hidden) closeVerificationModal();
  }
});

document.addEventListener("gimerr:video-view", (event) => {
  const postId = event.detail?.postId;
  const videoViewCount = Number(event.detail?.videoViewCount || 0);
  if (!postId) return;
  posts = posts.map((post) => (
    String(post.id) === String(postId)
      ? { ...post, videoViewCount }
      : post
  ));
});

els.openComposer?.addEventListener("click", () => {
  openComposerAndFocus();
});

els.closeComposer?.addEventListener("click", () => {
  setComposerOpen(false);
});

window.addEventListener("resize", () => {
  if (!els.composer || els.composer.hidden) return;
  els.composer.classList.add("is-mobile-open");
  document.body.classList.add("has-mobile-composer-open");
});

els.composerGameSearch?.addEventListener("input", (event) => {
  const value = event.target.value || "";
  if (state.composerSelectedGame && value !== state.composerSelectedGame.name) {
    clearComposerGameSelection();
  }
  clearTimeout(state.composerGameSearchTimer);
  state.composerGameSearchTimer = window.setTimeout(() => searchComposerGames(value), 220);
});

els.composerGameSearch?.addEventListener("focus", () => {
  const value = els.composerGameSearch.value || "";
  if (state.composerGameResults.length) {
    renderComposerGameSuggestions(state.composerGameResults);
    return;
  }
  if (value.trim().length >= 2) searchComposerGames(value);
});

els.composerGameSelected?.addEventListener("click", (event) => {
  const clearButton = event.target instanceof Element
    ? event.target.closest("[data-composer-game-clear]")
    : null;
  if (!clearButton) return;
  event.preventDefault();
  clearComposerGameSelection();
  window.setTimeout(() => els.composerGameSearch?.focus());
});

els.composerGameSuggestions?.addEventListener("click", (event) => {
  const submitButton = event.target instanceof Element
    ? event.target.closest("[data-composer-game-submit]")
    : null;
  if (submitButton) {
    event.preventDefault();
    const term = submitButton.dataset.query || els.composerGameSearch?.value || "";
    hideComposerGameSuggestions();
    setComposerOpen(false);
    window.setTimeout(() => openComposerGameRequest(term), 0);
    return;
  }

  const button = event.target instanceof Element
    ? event.target.closest("[data-composer-game-id]")
    : null;
  if (!button) return;
  event.preventDefault();
  const game = state.composerGameResults.find((item) => String(item.id) === String(button.dataset.composerGameId));
  if (game) selectComposerGame(game);
});

async function init() {
  if (redirectLegacySharedPostUrl()) return;

  renderFeedLoading();

  const canRender = await withTimeout(
    hydrateAuthenticatedHome(),
    15000,
    "A autenticação demorou mais que o esperado.",
  ).catch((error) => {
    console.error("Falha ao iniciar o index.", error);
    els.feedList.innerHTML = `<div class="post-card empty-state">Não foi possível iniciar sua sessão. Recarregue a página.</div>`;
    return false;
  });
  if (!canRender) return;
  const routeListingPostId = getListingRoutePostId();
  const routeEditListingPostId = getEditListingRoutePostId();

  await completeDiscordConnectionFromCallback();

  setPublishing(true, "Carregando...");

  if (shouldOpenComposerFromRoute()) {
    openComposerAndFocus();
    clearComposerRouteFlag();
  }

  const sidebarPromise = withTimeout(loadIndexSidebar(), 12000, "A sidebar demorou mais que o esperado.")
    .catch((error) => {
      console.warn("Não foi possível carregar dados da sidebar.", error);
      state.followedGames = [];
      state.sidebarMode = state.signedIn ? "authenticated" : "guest";
    })
    .finally(() => {
      renderIndexSidebar();
      renderLiveStack();
      setComposerAvailability();
      renderFeed({ prepareVideos: false });
    });

  const followedProfilesPromise = withTimeout(loadRecommendedProfiles(), 12000, "A lista de perfis recomendados demorou mais que o esperado.")
    .catch((error) => {
      console.warn("Não foi possível carregar perfis recomendados.", error);
      state.followedProfiles = [];
    });

  const currentProfilePromise = withTimeout(loadCurrentProfile(), 12000, "O perfil demorou mais que o esperado.")
    .catch((error) => {
      console.warn("Não foi possível carregar telefone verificado.", error);
      state.currentProfile = null;
    })
    .finally(() => {
      setComposerAvailability();
    });

    const feedPromise = withTimeout(loadFeedPosts(), 12000, "O feed demorou mais que o esperado.")
    .then(() => {
      setComposerAvailability();
      renderFeed();
    })
    .catch((error) => {
      console.warn("Não foi possível carregar posts do feed.", error);
      posts = [];
      state.feedHasMore = false;
      renderFeed();
    });

  await Promise.allSettled([sidebarPromise, followedProfilesPromise, currentProfilePromise, feedPromise]);
  if (routeEditListingPostId) {
    await startListingEdit(routeEditListingPostId);
  } else if (routeListingPostId) {
    await openListingDetail(routeListingPostId);
  }
}

init();
