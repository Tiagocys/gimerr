(function initGamePage() {
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

  const state = {
    session: null,
    loading: true,
    game: null,
    followers: [],
    followedProfiles: [],
    followerCount: 0,
    following: false,
    feed: [],
    filter: "all",
    marketplaceSearch: "",
    activeCommentPostId: "",
    activeCommentsPostId: "",
    commentSubmittingPostId: "",
    editingPostId: "",
    editSubmittingPostId: "",
    replyingToCommentId: "",
    commentsLoadingPostId: "",
    commentsByPost: {},
    commentsErrorByPost: {},
    composerMode: "listing",
    composerPreviewUrls: [],
    composerSelectedFiles: [],
    listingCurrency: "",
    listingItemDrafts: [],
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
    layout: document.querySelector("#game-layout"),
    logo: document.querySelector("#game-logo"),
    title: document.querySelector("#game-title"),
    description: document.querySelector("#game-description"),
    metaList: document.querySelector("#game-meta-list"),
    followButton: document.querySelector("#game-follow-button"),
    followersPanel: document.querySelector("#game-followers-panel"),
    followersPanelClose: document.querySelector("#game-followers-close"),
    followersButton: document.querySelector("#game-followers-button"),
    followersCount: document.querySelector("#game-followers-count"),
    followersSideCount: document.querySelector("#game-followers-side-count"),
    listingsButton: document.querySelector("#game-listings-button"),
    listingsCount: document.querySelector("#game-listings-count"),
    followersList: document.querySelector("#game-followers-list"),
    feedList: document.querySelector("#game-feed-list"),
    filterButtons: document.querySelectorAll("[data-game-feed-filter]"),
    marketplaceSearchWrap: document.querySelector("#game-marketplace-feed-search"),
    marketplaceSearchLabel: document.querySelector("#game-marketplace-search-label"),
    marketplaceSearch: document.querySelector("#game-marketplace-search"),
    feedSubtitle: document.querySelector("#game-feed-subtitle"),
    composer: document.querySelector("#game-composer"),
    composerText: document.querySelector("#game-composer-text"),
    composerFile: document.querySelector("#game-composer-file"),
    composerVideoHelper: document.querySelector("#game-composer-video-helper"),
    composerMedia: document.querySelector("#game-composer-media"),
    composerFileName: document.querySelector("#game-composer-file-name"),
    composerMediaPreviews: document.querySelector("#game-composer-media-previews"),
    composerClearFile: document.querySelector("#game-composer-clear-file"),
    composerModeButtons: document.querySelectorAll("[data-game-composer-mode]"),
    listingComposerFields: document.querySelector("#game-listing-composer-fields"),
    composerListingHelper: document.querySelector("#game-composer-listing-helper"),
    listingCurrency: document.querySelector("#game-listing-currency"),
    listingItems: document.querySelector("#game-listing-items"),
    listingItemAdd: document.querySelector("#game-listing-item-add"),
    publishPost: document.querySelector("#game-publish-post"),
    composerFeedback: document.querySelector("#game-composer-feedback"),
    listingDetailModal: document.querySelector("#listing-detail-modal"),
    listingDetailContent: document.querySelector("#listing-detail-content"),
  };

  if (!window.GimerrAuth || !els.title) return;

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

  function getInitials(name) {
    return String(name || "Gimerr")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "GM";
  }

  function getGameTarget() {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("id") || params.get("igdbId") || params.get("game"));
    const slug = params.get("slug")?.trim();
    if (id) return { key: "id", value: String(id) };
    if (slug) return { key: "slug", value: slug };
    return null;
  }

  function getProfileUrl(profile) {
    if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
    return `./profile?id=${encodeURIComponent(profile.id)}`;
  }

  function getCurrentGameUrl() {
    if (state.game?.slug) return `./game?slug=${encodeURIComponent(state.game.slug)}`;
    return `./game?id=${encodeURIComponent(state.game?.igdbId || "")}`;
  }

  function getGameUrl(game) {
    if (!game) return getCurrentGameUrl();
    return game.slug
      ? `./game?slug=${encodeURIComponent(game.slug)}`
      : `./game?id=${encodeURIComponent(game.id || game.igdbId || state.game?.igdbId || "")}`;
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

  function renderMentionLine(authorName, post) {
    const mentions = extractMentionUsernames(post?.body || post?.text, post?.author?.username);
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

  function isVideoFile(file) {
    return Boolean(file?.type?.startsWith("video/"));
  }

  function isImageFile(file) {
    return Boolean(file?.type?.startsWith("image/"));
  }

  function validateComposerFiles(files, type) {
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
    if (files.length > 1) {
      window.alert("Posts comuns aceitam apenas um arquivo.");
      return false;
    }
    const [file] = files;
    if (isVideoFile(file)) {
      return true;
    }
    if (!isImageFile(file)) {
      window.alert("Selecione uma imagem JPG, PNG, WebP, GIF ou um vídeo MP4, WebM ou MOV.");
      return false;
    }
    return true;
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

  function getListingDraftItems() {
    syncListingDraftsFromDom();
    ensureListingDraftItems();
    return state.listingItemDrafts.map((item) => ({
      ...item,
      priceLabel: formatListingPrice(item.price),
    }));
  }

  function getListingItemsFromComposer() {
    return getListingDraftItems()
      .filter((item) => item.name || item.price || item.file);
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

  function getListingPreviewText(body) {
    const text = String(body || "");
    const marker = "\n\nItens:\n";
    const markerIndex = text.indexOf(marker);
    const description = markerIndex >= 0 ? text.slice(0, markerIndex).trim() : "";
    if (description) return truncateText(description, 58);
    const itemsText = markerIndex >= 0 ? text.slice(markerIndex + marker.length) : text.replace(/^Itens:\n/i, "");
    const firstLine = itemsText.split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
    const firstItemName = firstLine.split(/\s+-\s+/)[0]?.trim() || "";
    return truncateText(firstItemName, 58);
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
    if (!els.composerListingHelper) return;
    els.composerListingHelper.textContent = message;
    els.composerListingHelper.hidden = !message;
    els.composerListingHelper.className = `composer-submit-helper${tone ? ` is-${tone}` : ""}`;
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

  function getPostTypeFromComposer(files) {
    if (state.composerMode === "listing") return "listing";
    const [file] = files;
    if (isVideoFile(file)) return "video";
    return "post";
  }

  function setComposerFeedback(message = "", kind = "") {
    if (!els.composerFeedback) return;
    els.composerFeedback.textContent = message;
    els.composerFeedback.className = `field-feedback${kind ? ` is-${kind}` : ""}`;
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

  function formatCount(value) {
    return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
  }

  function truncateText(value, maxLength = 110) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trim()}...`;
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
    const post = state.feed.find((item) => String(item.id) === String(postId));
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
        text: `Publicado em ${state.game?.name || "Gimerr"}`,
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
    const description = markerIndex >= 0 ? text.slice(0, markerIndex).trim() : "";
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

  function getListingCardPreviewText(listingData) {
    const text = listingData?.description || listingData?.items?.find((item) => item.name)?.name || "";
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > 58 ? `${clean.slice(0, 58).trim()}...` : clean;
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
      id: state.game?.igdbId || state.game?.id || "",
      slug: state.game?.slug || "",
      name: state.game?.name || "Game",
      coverUrl: state.game?.coverUrl || "./assets/avatar.svg",
    };
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
    const game = getListingGame(post);
    const author = post.author || {};
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
    const index = state.feed.findIndex((item) => String(item.id) === String(detailPost.id));
    if (index >= 0) {
      state.feed[index] = {
        ...state.feed[index],
        ...detailPost,
        author: {
          ...(state.feed[index].author || {}),
          ...(detailPost.author || {}),
        },
        game: {
          ...(getListingGame(state.feed[index]) || {}),
          ...(detailPost.game || {}),
        },
      };
      return state.feed[index];
    }
    return {
      ...fallbackPost,
      ...detailPost,
      author: {
        ...(fallbackPost?.author || {}),
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
      state.feed = state.feed.map((post) => (
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
    const feedPost = state.feed.find((item) => String(item.id) === String(postId));
    if (!els.listingDetailModal || !els.listingDetailContent) return;
    if (feedPost && feedPost.type !== "listing") return;
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
        if (!detailPost || detailPost.type !== "listing") throw new Error("Anúncio não encontrado.");
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
      if (feedPost?.type === "listing") {
        recordListingView(postId);
        els.listingDetailContent.innerHTML = renderListingDetail(feedPost, null);
        window.GimerrVideoPlayer?.prepare?.(els.listingDetailContent);
        return;
      }
      els.listingDetailContent.innerHTML = `<div class="listing-detail-loading">Não foi possível carregar este anúncio.</div>`;
    }
  }

  function getPostMediaItems(post) {
    const items = Array.isArray(post.mediaItems) ? post.mediaItems : [];
    if (items.length) return items.filter((item) => item?.url);
    const mediaUrl = post.mediaUrl || post.image;
    return mediaUrl
      ? [{ url: mediaUrl, mediaType: post.mediaType }]
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

  function renderPostMedia(post) {
    if (post.type === "listing") return renderListingMedia(post);
    const items = getPostMediaItems(post);
    const videoItem = items.find((item) => String(item?.mediaType || "").startsWith("video/"));
    if (videoItem?.url) return renderVideoPoster(post, videoItem);
    const imageItems = items.filter((item) => item.mediaType?.startsWith("image/"));
    const [firstImage] = imageItems;
    if (!firstImage?.url) return "";
    if (imageItems.length === 1) {
      return `
        <button class="media-zoom-button" type="button" data-image-src="${escapeHtml(firstImage.url)}" ${renderImageLightboxAttrs(post, "Imagem do anúncio")}>
          <img class="media-frame" src="${escapeHtml(firstImage.url)}" alt="">
        </button>
      `;
    }
    return `
      <button class="media-zoom-button listing-preview-button" type="button" data-image-src="${escapeHtml(firstImage.url)}" data-image-index="0" ${renderImageGalleryAttrs(imageItems)} ${renderImageLightboxAttrs(post, "Imagem do anúncio")}>
        <img src="${escapeHtml(firstImage.url)}" alt="">
        <span class="listing-preview-count">+${imageItems.length - 1}</span>
      </button>
    `;
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

      state.feed = state.feed.map((post) => (
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

  function setPublishing(isPublishing, label = "Publicar") {
    if (els.publishPost) {
      els.publishPost.disabled = isPublishing || !state.session?.user || !state.game;
      els.publishPost.textContent = isPublishing
        ? label
        : (state.composerMode === "listing" ? "Publicar anúncio" : "Publicar");
    }
    if (els.composerText) els.composerText.disabled = isPublishing || !state.session?.user || !state.game;
    if (els.composerFile) els.composerFile.disabled = isPublishing || !state.session?.user || !state.game;
    els.composerModeButtons.forEach((button) => {
      button.disabled = isPublishing || !state.session?.user || !state.game;
    });
    if (els.listingCurrency) els.listingCurrency.disabled = isPublishing || !state.session?.user || !state.game;
    if (els.listingItemAdd) els.listingItemAdd.disabled = isPublishing || !state.session?.user || !state.game;
    els.listingItems?.querySelectorAll("input, button").forEach((field) => {
      field.disabled = isPublishing || !state.session?.user || !state.game;
    });
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
      if (!item.file) {
        uploadedItems.push(baseItem);
        continue;
      }
      uploadIndex += 1;
      const uploaded = await uploadComposerMedia(item.file, "listing");
      uploadedItems.push({
        ...baseItem,
        url: uploaded.url,
        key: uploaded.key,
        mediaType: uploaded.mediaType,
      });
    }
    if (videoFiles.length) {
      const uploaded = await uploadComposerMedia(videoFiles[0], "video");
      uploadedItems.push({
        url: uploaded.url,
        key: uploaded.key,
        mediaType: uploaded.mediaType,
        mediaRole: "listingVideo",
      });
    }
    return uploadedItems;
  }

  async function createGamePost({ type, text, uploadedMediaItems }) {
    const primaryMedia = uploadedMediaItems.find((item) => item?.url && item?.key) || null;
    const response = await fetch("/api/posts/create", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        gameId: state.game.igdbId,
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

  function clearComposerFile(options = {}) {
    revokeComposerPreviewUrls();
    state.composerSelectedFiles = [];
    if (els.composerFile) els.composerFile.value = "";
    if (els.composerMedia) els.composerMedia.hidden = true;
    if (els.composerFileName) els.composerFileName.textContent = "";
    if (els.composerMediaPreviews) els.composerMediaPreviews.innerHTML = "";
    if (!options.preserveVideoHelper) {
      setVideoHelperMessage("");
      clearComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
    }
  }

  function revokeComposerPreviewUrls() {
    state.composerPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    state.composerPreviewUrls = [];
  }

  function getFileSignature(file) {
    return [file.name, file.size, file.lastModified, file.type].join(":");
  }

  function getComposerFiles() {
    return state.composerSelectedFiles;
  }

  function addComposerSelectedFiles(files) {
    state.composerSelectedFiles = Array.from(files || []).slice(0, 1);
  }

  async function renderComposerFile() {
    const selectedFiles = Array.from(els.composerFile?.files || []);
    if (selectedFiles.length) addComposerSelectedFiles(selectedFiles);
    if (els.composerFile) els.composerFile.value = "";

    const files = getComposerFiles();
    if (!files.length) {
      clearComposerFile();
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
    if (els.composerMedia) els.composerMedia.hidden = false;
    if (els.composerFileName) {
      els.composerFileName.textContent = files.length === 1
        ? files[0].name
        : `${files.length} imagens selecionadas`;
    }
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

  function resetListingItems() {
    state.listingItemDrafts.forEach(revokeListingPreview);
    state.listingItemDrafts = [createListingDraftItem()];
    renderListingItems(state.listingItemDrafts);
  }

  function resetListingCurrency() {
    state.listingCurrency = "";
    if (els.listingCurrency) els.listingCurrency.value = "";
  }

  function setComposerMode(mode) {
    state.composerMode = "listing";
    els.composer?.classList.add("is-listing-mode");
    els.composerModeButtons.forEach((button) => {
      const active = button.dataset.gameComposerMode === "listing";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    syncComposerListingState();
  }

  function syncComposerListingState() {
    const isListing = true;
    if (els.listingComposerFields) els.listingComposerFields.hidden = !isListing;
    if (els.composerListingHelper) {
      showListingHelperMessage();
    }
    if (els.composerText) {
      els.composerText.placeholder = "Descreva seu anúncio: itens, condições de compra, troca, entrega ou outras informações importantes.";
    }
    if (isListing && els.listingItems && !els.listingItems.children.length) {
      renderListingItems();
    }
    if (els.composerFile) {
      els.composerFile.multiple = false;
      els.composerFile.accept = "video/mp4,video/webm,video/quicktime";
    }
    if (els.publishPost && !els.publishPost.disabled) {
      els.publishPost.textContent = "Publicar anúncio";
    }
  }

  async function publishGamePost() {
    if (!state.session?.user) {
      window.location.assign("./sign-in.html");
      return;
    }
    if (!state.game) return;

    const text = els.composerText?.value?.trim() || "";
    const type = "listing";
    const listingItems = type === "listing" ? getListingItemsFromComposer() : [];
    const itemImageFiles = listingItems.map((item) => item.file).filter(Boolean);
    const videoFiles = getComposerFiles();
    const files = [...itemImageFiles, ...videoFiles];
    const finalText = type === "listing" ? buildListingBody(text, listingItems) : text;

    if (type === "listing" && !validateListingCurrency()) return;

    if (type === "listing" && !validateListingItems(listingItems)) return;

    if (!finalText && !files.length) {
      els.composerText?.focus();
      return;
    }

    if (!validateListingItemImageFiles(itemImageFiles)) return;
    if (!validateComposerFiles(videoFiles, type)) return;
    if (!await validateListingVideoDuration(videoFiles)) return;

    try {
      setComposerFeedback("");
      setPublishing(true, "Publicando...");
      let uploadedMediaItems = [];
      if (type === "listing") {
        uploadedMediaItems = await buildListingMediaItemsForSave(listingItems, videoFiles);
      } else {
        const uploadTarget = files.length ? type : "post";
        uploadedMediaItems = await uploadComposerMediaItems(files, uploadTarget);
      }
      await createGamePost({ type, text: finalText, uploadedMediaItems });
      if (els.composerText) els.composerText.value = "";
      if (type === "listing") {
        resetListingCurrency();
        resetListingItems();
      }
      clearComposerFile();
      setComposerMode("listing");
      await loadGame();
      setComposerFeedback("Publicado.", "success");
    } catch (error) {
      console.warn("Não foi possível publicar no game.", error);
      setComposerFeedback(error.message || "Não foi possível publicar.", "error");
    } finally {
      setPublishing(false);
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
    state.feed = state.feed.map((post) => (
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
    if (!response.ok) throw new Error(payload.error || "Não foi possível apagar este anúncio.");

    state.feed = state.feed.filter((post) => String(post.id) !== String(postId));
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
    const post = state.feed.find((item) => String(item.id) === String(postId));
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

    state.feed = state.feed.map((item) => (
      String(item.id) === String(postId)
        ? { ...item, body: payload.post?.body ?? String(body || "").trim() }
        : item
    ));
    state.editingPostId = "";
    state.editSubmittingPostId = "";
    renderFeed({ prepareVideos: false });
  }

  function getTaxonomyNames(items, limit = 4) {
    return Array.isArray(items)
      ? items.slice(0, limit).map((item) => item?.abbreviation || item?.name).filter(Boolean)
      : [];
  }

  function setLoading(message) {
    els.title.textContent = message;
    els.description.textContent = "";
    els.feedList.classList.remove("is-marketplace-grid", "is-empty");
    els.feedList.innerHTML = "";
  }

  function setMissing(message) {
    state.loading = false;
    els.layout.classList.remove("is-loading");
    els.title.textContent = "Jogo não encontrado";
    els.description.textContent = message;
    els.followButton.hidden = true;
    els.feedList.classList.remove("is-marketplace-grid");
    els.feedList.classList.add("is-empty");
    els.feedList.innerHTML = `<div class="post-card empty-state">${escapeHtml(message)}</div>`;
    els.followersList.innerHTML = `<div class="empty-state">Nenhum seguidor por aqui.</div>`;
  }

  function renderGame() {
    const game = state.game;
    if (!game) return;

    document.title = `${game.name} | Gimerr`;
    els.title.textContent = game.name;
    els.description.textContent = game.summary || "Este jogo ainda não tem descrição cadastrada.";
    els.logo.innerHTML = `<img src="${escapeHtml(game.coverUrl || "./assets/avatar.svg")}" alt="">`;

    const genres = getTaxonomyNames(game.genres, 5);
    const platforms = getTaxonomyNames(game.platforms, 8);
    els.metaList.innerHTML = `
      ${genres.map((genre) => `<span class="info-pill">${escapeHtml(genre)}</span>`).join("")}
      ${platforms.map((platform) => `<span class="info-pill">${escapeHtml(platform)}</span>`).join("")}
    `;

    if (els.feedSubtitle) {
      els.feedSubtitle.textContent = `Anúncios publicados em ${game.name}.`;
    }
    if (els.marketplaceSearchLabel) {
      els.marketplaceSearchLabel.textContent = `Buscar no Marketplace do ${game.name}`;
    }
    renderFollowState();
    renderFollowers();
    renderFeed();
  }

  function renderFollowState() {
    if (state.loading) return;
    els.followersCount.textContent = formatCount(state.followerCount);
    els.followersSideCount.textContent = formatCount(state.followerCount);
    els.followButton.disabled = !state.session?.user || !state.game;
    els.followButton.textContent = state.following ? "Seguindo" : "Seguir";
    els.followButton.classList.toggle("is-secondary-state", state.following);
    if (!state.session?.user) {
      els.followButton.textContent = "Entre para seguir";
    }
    setPublishing(false);
  }

  function renderFollowers() {
    if (state.loading) return;
    if (!state.followers.length) {
      els.followersList.innerHTML = `<div class="empty-state">Nenhum seguidor por aqui.</div>`;
      return;
    }

    els.followersList.innerHTML = state.followers.map((follower) => `
      <a class="people-row" href="${getProfileUrl(follower)}">
        <div class="post-avatar">
          <img src="${escapeHtml(follower.avatarUrl || "./assets/avatar.svg")}" alt="">
        </div>
        <div>
          <strong>${escapeHtml(follower.displayName)}</strong>
          ${follower.username ? `<span>@${escapeHtml(follower.username)}</span>` : ""}
        </div>
      </a>
    `).join("");
  }

  function setFollowersPanelOpen(open) {
    els.followersPanel?.classList.toggle("is-open", open);
    els.followersButton?.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.classList.toggle("has-game-followers-open", open);
  }

  function isFollowersPanelOpen() {
    return Boolean(els.followersPanel?.classList.contains("is-open"));
  }

  function setFeedFilter(filter, { scroll = false } = {}) {
    state.filter = filter === "listing" ? "listing" : "all";
    els.filterButtons.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.gameFeedFilter === state.filter);
    });
    renderFeed();
    if (scroll) {
      document.querySelector(".filter-bar")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
    if (state.loading) return;
    const posts = state.feed.filter((item) => item.type !== "listing");
    const listings = state.feed.filter((item) => item.type === "listing");
    const marketplaceQuery = state.marketplaceSearch.trim().toLowerCase();
    const searchedListings = !marketplaceQuery
      ? listings
      : listings.filter((post) => {
        const listingData = getListingCardData(post);
        return [
          post.body,
          state.game?.name,
          post.author?.displayName,
          post.author?.username,
          ...(listingData.items || []).flatMap((item) => [item.name, item.priceLabel]),
        ].join(" ").toLowerCase().includes(marketplaceQuery);
      });
    const isListingFilter = state.filter === "listing";
    const filtered = isListingFilter ? searchedListings : posts;
    if (els.marketplaceSearchWrap) {
      els.marketplaceSearchWrap.hidden = !isListingFilter;
    }
    if (els.listingsCount) els.listingsCount.textContent = formatCount(listings.length);
    els.feedList.classList.toggle("is-marketplace-grid", isListingFilter && filtered.length > 0);
    els.feedList.classList.toggle("is-empty", !filtered.length);

    if (!filtered.length) {
      els.feedList.innerHTML = `<div class="post-card empty-state">${isListingFilter ? "Nenhum anúncio publicado para este jogo." : "Nenhum post publicado para este jogo."}</div>`;
      return;
    }

    els.feedList.innerHTML = filtered.map((post, index) => {
      if (post.type !== "listing") {
        const author = post.author || {};
        const authorName = author.displayName || author.username || "Usuário Gimerr";
        const authorHandle = author.username ? `@${author.username}` : "";
        const media = renderPostMedia(post);
        const cardHtml = `
          <article class="post-card">
            ${media}
            <div class="post-body">
              ${renderMentionLine(authorName, post)}
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
              <div>
                ${renderPostTextBlock(post, post.body ? renderTextWithMentions(post.body, author.username) : "")}
              </div>
              <a class="channel-line" href="${getCurrentGameUrl()}">
                <span class="channel-game-logo" aria-hidden="true">
                  <img src="${escapeHtml(state.game?.coverUrl || "./assets/avatar.svg")}" alt="">
                </span>
                <span>Em ${escapeHtml(state.game?.name || "Game")} ${escapeHtml(formatRelativeTime(post.createdAt))}</span>
              </a>
              ${renderPostActions(post)}
            </div>
          </article>
        `;
        return cardHtml;
      }
      const listingData = getListingCardData(post);
      const bodyText = getListingCardPreviewText(listingData);
      const media = renderPostMedia(post);
      const cardHtml = `
      <article class="post-card marketplace-post-card">
        ${media}
        <div class="post-body">
          <div>
            ${bodyText ? `<p class="post-text">${escapeHtml(bodyText)}</p>` : ""}
          </div>
          <a class="channel-line" href="${getCurrentGameUrl()}">
            <span class="channel-game-logo" aria-hidden="true">
              <img src="${escapeHtml(state.game?.coverUrl || "./assets/avatar.svg")}" alt="">
            </span>
            <span>Em ${escapeHtml(state.game?.name || "Game")}</span>
          </a>
          ${renderPostActions(post)}
        </div>
      </article>
    `;
      return `${cardHtml}${isListingFilter ? renderMarketplaceAdAfter(index, filtered.length) : ""}`;
    }).join("");
    if (prepareVideos) window.GimerrVideoPlayer?.prepare(els.feedList);
    if (isListingFilter) window.GimerrAdcashAds?.prepareMarketplaceAds?.(els.feedList);
  }

  async function loadGame() {
    const target = getGameTarget();
    if (!target) {
      setMissing("Abra a página a partir de um jogo da busca.");
      return;
    }

    setLoading("Carregando jogo...");
    const { data } = await window.GimerrAuth.getSession();
    state.session = data.session;

    const response = await fetch(`/api/games/detail?${target.key}=${encodeURIComponent(target.value)}`, {
      headers: {
        accept: "application/json",
        ...(state.session?.access_token ? { authorization: `Bearer ${state.session.access_token}` } : {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMissing(payload.error || "Não foi possível carregar este jogo.");
      return;
    }

    state.game = payload.game;
    state.followers = payload.followers || [];
    state.followerCount = Number(payload.followerCount || 0);
    state.following = Boolean(payload.isFollowing);
    state.feed = payload.feed || [];
    await loadRecommendedProfiles().catch((error) => {
      console.warn("Não foi possível carregar perfis recomendados para marcações.", error);
      state.followedProfiles = [];
    });
    state.loading = false;
    els.layout.classList.remove("is-loading");
    renderGame();
  }

  async function loadRecommendedProfiles() {
    if (!state.session?.user || !window.GimerrAuth) {
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

    const followedIds = [...new Set((recommendations || [])
      .map((row) => row.recommended_id)
      .filter(Boolean))];

    if (!followedIds.length) {
      state.followedProfiles = [];
      return;
    }

    const { data: profiles, error: profilesError } = await client
      .from("public_profiles")
      .select("id, display_name, username, avatar_url")
      .in("id", followedIds);

    if (profilesError) throw profilesError;

    const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
    state.followedProfiles = followedIds
      .map((id) => normalizeFollowedProfile(byId.get(id)))
      .filter(Boolean);
  }

  async function toggleFollow() {
    if (!state.session?.user) {
      window.location.assign("./sign-in.html");
      return;
    }
    if (!state.game) return;

    const nextFollowing = !state.following;
    els.followButton.disabled = true;
    els.followButton.textContent = nextFollowing ? "Seguindo..." : "Removendo...";

    try {
      const response = await fetch("/api/games/follow", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${state.session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          igdbId: state.game.igdbId,
          following: nextFollowing,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar jogo seguido.");

      state.following = nextFollowing;
      state.followerCount = Math.max(0, state.followerCount + (nextFollowing ? 1 : -1));
      await loadGame();
    } catch (error) {
      console.warn(error);
      renderFollowState();
    }
  }

  els.followButton.addEventListener("click", toggleFollow);
  els.followersButton?.addEventListener("click", () => setFollowersPanelOpen(!isFollowersPanelOpen()));
  els.followersPanelClose?.addEventListener("click", () => setFollowersPanelOpen(false));
  els.listingsButton?.addEventListener("click", () => setFeedFilter("listing", { scroll: true }));
  els.marketplaceSearch?.addEventListener("input", (event) => {
    state.marketplaceSearch = event.target.value;
    renderFeed();
  });
  els.publishPost?.addEventListener("click", publishGamePost);
  els.composerFile?.addEventListener("change", () => {
    renderComposerFile().catch((error) => {
      console.warn("Não foi possível validar o vídeo selecionado.", error);
      setVideoHelperMessage("Não foi possível validar o vídeo selecionado. Tente outro arquivo.", "warning");
      markComposerInvalid(els.composer?.querySelector(".listing-video-upload"));
      clearComposerFile({ preserveVideoHelper: true });
    });
  });
  els.composerClearFile?.addEventListener("click", clearComposerFile);
  els.composerText?.addEventListener("input", () => {
    if (state.composerMode === "listing") showListingHelperMessage();
  });
  els.composerModeButtons.forEach((button) => {
    button.addEventListener("click", () => setComposerMode(button.dataset.gameComposerMode));
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
  els.listingDetailModal?.addEventListener("click", (event) => {
    if (event.target === els.listingDetailModal) closeListingDetailModal();
  });
  setComposerMode("listing");
  els.filterButtons.forEach((button) => {
    button.addEventListener("click", () => setFeedFilter(button.dataset.gameFeedFilter));
  });

  document.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target) return;

    if (
      isFollowersPanelOpen()
      && !target.closest("#game-followers-panel")
      && !target.closest("#game-followers-button")
      && window.matchMedia("(max-width: 820px)").matches
    ) {
      event.preventDefault();
      setFollowersPanelOpen(false);
      return;
    }

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
      closePostMenus();
      closeCommentMentionSuggestions();
      setFollowersPanelOpen(false);
    }
  });

  document.addEventListener("gimerr:video-view", (event) => {
    const postId = event.detail?.postId;
    const videoViewCount = Number(event.detail?.videoViewCount || 0);
    if (!postId) return;
    state.feed = state.feed.map((post) => (
      String(post.id) === String(postId)
        ? { ...post, videoViewCount }
        : post
    ));
  });

  if (!redirectLegacySharedPostUrl()) loadGame();
})();
