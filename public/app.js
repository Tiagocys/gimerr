let posts = [];

const state = {
  filter: "all",
  search: "",
  postType: "post",
  signedIn: false,
  session: null,
  followedGames: [],
  liveUpdates: [],
  preparedMediaFile: null,
};

const els = {
  followedGamesPanel: document.querySelector("#followed-games-panel"),
  serverList: document.querySelector("#server-list"),
  serverCount: document.querySelector("#server-count"),
  feedList: document.querySelector("#feed-list"),
  livePanel: document.querySelector("#live-panel"),
  liveStack: document.querySelector("#live-stack"),
  search: document.querySelector("#global-search"),
  filterButtons: document.querySelectorAll(".filter-chip"),
  tabButtons: document.querySelectorAll(".tab-button"),
  composerText: document.querySelector("#composer-text"),
  composerServer: document.querySelector("#composer-server"),
  composerFile: document.querySelector("#composer-file"),
  composerMedia: document.querySelector("#composer-media"),
  composerFileName: document.querySelector("#composer-file-name"),
  composerClearFile: document.querySelector("#composer-clear-file"),
  publishPost: document.querySelector("#publish-post"),
  openComposer: document.querySelector("#open-composer"),
  composer: document.querySelector("#composer"),
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

function cleanAuthUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("code")) return;
  window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
}

function normalizeFollowedGame(row) {
  const game = row.game || row.igdb_games || {};
  return {
    id: game.igdb_id,
    name: game.name || "Game Gimerr",
    slug: game.slug || "",
    coverUrl: game.cover_url || "",
    followedAt: row.created_at,
  };
}

function getGame(gameId) {
  return state.followedGames.find((game) => String(game.id) === String(gameId)) || null;
}

function getGameUrl(game) {
  if (!game) return "./game";
  return game.slug
    ? `./game?slug=${encodeURIComponent(game.slug)}`
    : `./game?id=${encodeURIComponent(game.id)}`;
}

function typeLabel(type) {
  if (type === "video") return "Vídeo";
  if (type === "listing") return "Marketplace";
  return "Imagem";
}

function isMobileVideoUploadDevice() {
  const userAgent = navigator.userAgent || "";
  const isMobileOs = /Android|iPhone|iPad|iPod/i.test(userAgent);
  const isTouchMac = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
  return isMobileOs || isTouchMac;
}

function isVideoFile(file) {
  return Boolean(file?.type?.startsWith("video/"));
}

function isImageFile(file) {
  return Boolean(file?.type?.startsWith("image/"));
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${value} B`;
}

function logVideoStage(stage, details = {}) {
  console.log(`[gimerr-video] ${stage}`, {
    ts: new Date().toISOString(),
    ...details,
  });
}

function getComposerAccept(type = state.postType) {
  return type === "video"
    ? "video/mp4,video/webm,video/quicktime"
    : "image/jpeg,image/png,image/webp,image/gif";
}

function validateComposerFile(file, type = state.postType) {
  if (!file) return true;
  if (type === "video") {
    logVideoStage("validating-file", {
      name: file.name,
      type: file.type,
      size: formatFileSize(file.size),
      userAgent: navigator.userAgent,
    });
    if (!isVideoFile(file)) {
      logVideoStage("validation-failed", { reason: "not-video", type: file.type });
      window.alert("Selecione um arquivo de vídeo para publicar na aba Vídeo.");
      return false;
    }
    if (isMobileVideoUploadDevice()) {
      logVideoStage("validation-failed", { reason: "mobile-device" });
      window.alert("O upload de vídeos pode ser feito apenas através de um PC/Mac.");
      return false;
    }
    logVideoStage("validation-ok");
    return true;
  }

  if (!isImageFile(file)) {
    window.alert("Selecione uma imagem para publicar nesta aba.");
    return false;
  }
  return true;
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
  const isOwner = state.session?.user?.id && post.author?.id === state.session.user.id;
  return `
    <div class="post-menu" data-post-menu>
      <button class="ghost-icon post-menu-button" type="button" data-post-menu-toggle data-post-id="${postId}" aria-label="Abrir menu do post" aria-expanded="false">
        <span aria-hidden="true">&#8942;</span>
      </button>
      <div class="post-menu-popover" hidden>
        <button type="button" data-post-share data-post-id="${postId}">Compartilhar</button>
        ${!isOwner ? `<button type="button" data-post-report data-post-id="${postId}">Denunciar</button>` : ""}
        ${isOwner ? `<button class="danger" type="button" data-post-delete data-post-id="${postId}">Apagar post</button>` : ""}
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

  const reason = window.prompt("Informe o motivo da denúncia. Você pode deixar em branco.");
  if (reason === null) return;

  const response = await fetch("/api/posts/report", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ postId, reason }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível denunciar este post.");
  window.alert("Denúncia enviada.");
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
  const post = posts.find((item) => String(item.id) === String(postId));
  const gameName = post?.game?.name || getGame(post?.gameId)?.name || "Gimerr";
  const title = post?.type === "video"
    ? `Veja este vídeo no Gimerr`
    : `Veja este post no Gimerr`;

  if (navigator.share) {
    await navigator.share({
      title,
      text: `Publicado em ${gameName}`,
      url,
    });
    return;
  }

  await copyTextToClipboard(url);
  window.alert("Link copiado.");
}

async function deletePost(postId) {
  if (!state.session?.access_token) return;
  const confirmed = window.confirm("Apagar este post? Essa ação também remove a mídia enviada.");
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

async function hydrateAuthenticatedHome() {
  try {
    const { data } = await window.GimerrAuth.getSession();
    if (!data.session?.user) {
      window.location.replace("./sign-in.html");
      return false;
    }

    state.signedIn = true;
    state.session = data.session;
    cleanAuthUrl();
    return true;
  } catch (error) {
    console.warn("Não foi possível carregar sessão do usuário.", error);
    window.location.replace("./sign-in.html");
    return false;
  }
}

async function loadFollowedGames() {
  const client = await window.GimerrAuth.getClient();
  const { data, error } = await client
    .from("game_follows")
    .select("created_at, game:igdb_games(igdb_id, name, slug, cover_url)")
    .eq("profile_id", state.session.user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  state.followedGames = (data || [])
    .map(normalizeFollowedGame)
    .filter((game) => game.id);
}

async function loadFeedPosts() {
  const response = await fetch("/api/posts/feed", {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o feed.");
  posts = payload.posts || [];
}

function setComposerAvailability() {
  const canPost = state.followedGames.length > 0;
  els.composerFile.accept = getComposerAccept();
  els.publishPost.textContent = "Publicar";
  els.composerText.disabled = !canPost;
  els.composerServer.disabled = !canPost;
  els.composerFile.disabled = !canPost;
  els.publishPost.disabled = !canPost;
  els.openComposer.disabled = !canPost;

  if (!canPost) {
    els.composerText.placeholder = "Siga pelo menos um game para publicar no feed.";
    els.composerServer.innerHTML = `<option value="">Siga um game primeiro</option>`;
    return;
  }

  els.composerText.placeholder = "Compartilhe uma jogada, venda um item ou chame a comunidade para jogar.";
  els.composerServer.innerHTML = state.followedGames.map((game) => `
    <option value="${escapeHtml(game.id)}">${escapeHtml(game.name)}</option>
  `).join("");
}

function renderFollowedGames() {
  els.serverCount.textContent = String(state.followedGames.length);
  els.followedGamesPanel.hidden = state.followedGames.length === 0;

  if (!state.followedGames.length) {
    els.serverList.innerHTML = "";
    return;
  }

  els.serverList.innerHTML = state.followedGames.map((game) => `
    <a class="server-item" href="${getGameUrl(game)}">
      <div class="server-logo">
        <img src="${escapeHtml(game.coverUrl || "./assets/avatar.svg")}" alt="">
      </div>
      <div class="server-copy">
        <strong>${escapeHtml(game.name)}</strong>
        <span class="server-meta">Game seguido</span>
      </div>
    </a>
  `).join("");
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
  els.feedList.innerHTML = `
    <article class="post-card feed-skeleton" aria-label="Carregando feed"></article>
    <article class="post-card feed-skeleton" aria-label="Carregando feed"></article>
  `;
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function renderFeed() {
  const followedIds = new Set(state.followedGames.map((game) => String(game.id)));
  const query = state.search.trim().toLowerCase();
  const filtered = posts.filter((post) => {
    const game = post.game || getGame(post.gameId);
    const matchesFollowedGame = followedIds.has(String(post.gameId));
    const matchesType = state.filter === "all"
      || state.filter === "following"
      || post.type === state.filter;
    const matchesSearch = !query || [post.body, game?.name, post.author?.displayName, post.author?.username]
      .join(" ")
      .toLowerCase()
      .includes(query);
    const matchesScope = state.filter !== "following" || matchesFollowedGame;
    return matchesScope && matchesType && matchesSearch;
  });

  if (!filtered.length) {
    els.feedList.innerHTML = `<div class="post-card empty-state">Nada novo por aqui.</div>`;
    return;
  }

  els.feedList.innerHTML = filtered.map((post) => {
    const game = post.game || getGame(post.gameId);
    const author = post.author || {};
    const authorName = author.displayName || "Usuário Gimerr";
    const authorHandle = author.username ? `@${author.username}` : "@gimerr";
    const media = post.mediaUrl
      ? post.mediaType?.startsWith("video/")
        ? `<video class="media-frame" data-fluid-video src="${escapeHtml(post.mediaUrl)}" ${post.videoThumbnailUrl ? `poster="${escapeHtml(post.videoThumbnailUrl)}"` : ""} controls playsinline preload="metadata"></video>`
        : `<img class="media-frame" src="${escapeHtml(post.mediaUrl)}" alt="">`
      : "";
    return `
      <article class="post-card">
        ${media}
        <div class="post-body">
          <div class="post-meta">
            <div class="author-block">
              <div class="post-avatar">
                <img src="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}" alt="">
              </div>
              <div class="author-copy">
                <strong>${escapeHtml(authorName)}</strong>
                <span>${escapeHtml(authorHandle)} · ${escapeHtml(formatRelativeTime(post.createdAt))}</span>
              </div>
            </div>
            <div class="post-card-tools">
              ${renderPostMenu(post)}
            </div>
          </div>
          <div>
            <h3 class="post-title">${typeLabel(post.type)}</h3>
            ${post.body ? `<p class="post-text">${escapeHtml(post.body)}</p>` : ""}
          </div>
          <a class="channel-line" href="${getGameUrl(game)}">
            <span class="channel-dot" aria-hidden="true"></span>
            <span>${escapeHtml(game?.name || "Game")}</span>
          </a>
        </div>
      </article>
    `;
  }).join("");
  window.GimerrVideoPlayer?.prepare(els.feedList);
}

function setFilter(nextFilter) {
  state.filter = nextFilter;
  els.filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === nextFilter);
  });
  renderFeed();
}

function setPostType(nextType) {
  state.postType = nextType;
  els.composerFile.accept = getComposerAccept(nextType);
  els.tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.postType === nextType);
  });
  const [file] = els.composerFile.files;
  if (file && !validateComposerFile(file, nextType)) {
    clearComposerFile();
  }
}

async function prepareComposerUploadFile(file, type) {
  if (!file) return null;
  if (!validateComposerFile(file, type)) return null;
  if (type === "video") {
    logVideoStage("client-compression-skipped", {
      reason: "server-worker-enabled",
      uploadMode: "original-first",
      size: formatFileSize(file.size),
    });
  }
  return file;
}

async function uploadComposerMedia(file, target) {
  if (!file) return null;
  if (target === "video") {
    logVideoStage("upload-started", {
      name: file.name,
      type: file.type,
      size: formatFileSize(file.size),
    });
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
  if (!response.ok) throw new Error(payload.error || "Não foi possível enviar a mídia.");
  if (target === "video") {
    logVideoStage("upload-finished", {
      key: payload.key,
      url: payload.url,
      mediaType: payload.mediaType,
    });
  }
  return payload;
}

async function createFeedPost({ game, type, text, uploadedMedia }) {
  if (type === "video") {
    logVideoStage("post-create-started", {
      gameId: game.id,
      mediaKey: uploadedMedia?.key || null,
    });
  }
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
      mediaUrl: uploadedMedia?.url || null,
      mediaKey: uploadedMedia?.key || null,
      mediaType: uploadedMedia?.mediaType || null,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível publicar.");
  if (type === "video") {
    logVideoStage("post-create-finished", {
      postId: payload.post?.id,
    });
  }
  return payload.post;
}

function setPublishing(isPublishing, label = "Publicar") {
  const unavailable = !state.followedGames.length;
  els.publishPost.disabled = isPublishing || unavailable;
  els.publishPost.textContent = isPublishing ? label : "Publicar";
  els.composerText.disabled = isPublishing || unavailable;
  els.composerServer.disabled = isPublishing || unavailable;
  els.composerFile.disabled = isPublishing || unavailable;
}

async function publishPost() {
  if (!state.followedGames.length) {
    return;
  }

  const text = els.composerText.value.trim();
  const [file] = els.composerFile.files;

  if (!text && !file) {
    els.composerText.focus();
    return;
  }

  const game = getGame(els.composerServer.value);
  if (!game) return;

  const type = state.postType;
  try {
    const preparedFile = await prepareComposerUploadFile(file, type);
    if (file && !preparedFile) return;
    setPublishing(true, preparedFile ? "Enviando..." : "Publicando...");
    const uploadedMedia = await uploadComposerMedia(preparedFile, type);
    setPublishing(true, "Publicando...");
    await createFeedPost({ game, type, text, uploadedMedia });
    els.composerText.value = "";
    clearComposerFile();
    await loadFeedPosts();
    renderFeed();
  } catch (error) {
    console.warn("Não foi possível publicar.", error);
    window.alert(error.message || "Não foi possível publicar.");
  } finally {
    setPublishing(false);
  }
}

function renderComposerFile() {
  const [file] = els.composerFile.files;
  if (!file) {
    els.composerMedia.hidden = true;
    els.composerFileName.textContent = "";
    state.preparedMediaFile = null;
    return;
  }

  if (!validateComposerFile(file)) {
    clearComposerFile();
    return;
  }

  els.composerMedia.hidden = false;
  els.composerFileName.textContent = file.name;
  state.preparedMediaFile = null;
}

function clearComposerFile() {
  els.composerFile.value = "";
  renderComposerFile();
}

els.filterButtons.forEach((button) => {
  button.addEventListener("click", () => setFilter(button.dataset.filter));
});

els.tabButtons.forEach((button) => {
  button.addEventListener("click", () => setPostType(button.dataset.postType));
});

els.search.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderFeed();
});

els.publishPost.addEventListener("click", publishPost);
els.composerFile.addEventListener("change", renderComposerFile);
els.composerClearFile.addEventListener("click", clearComposerFile);
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePostMenus();
});

els.openComposer.addEventListener("click", () => {
  if (!state.followedGames.length) return;
  els.composer.scrollIntoView({ behavior: "smooth", block: "start" });
  els.composerText.focus();
});

async function init() {
  if (redirectLegacySharedPostUrl()) return;

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

  setPublishing(true, "Carregando...");
  renderFeedLoading();

  const [followedResult, feedResult] = await Promise.allSettled([
    withTimeout(loadFollowedGames(), 15000, "A lista de games demorou mais que o esperado."),
    withTimeout(loadFeedPosts(), 15000, "O feed demorou mais que o esperado."),
  ]);

  if (followedResult.status === "rejected") {
    const error = followedResult.reason;
    console.warn("Não foi possível carregar games seguidos.", error);
    state.followedGames = [];
  }

  if (feedResult.status === "rejected") {
    const error = feedResult.reason;
    console.warn("Não foi possível carregar posts do feed.", error);
    posts = [];
  }

  renderFollowedGames();
  renderLiveStack();
  setComposerAvailability();
  renderFeed();
}

init();
