let posts = [];

const DISCORD_INVITE_FALLBACK = "https://discord.gg/tCPVFu6juS";

const state = {
  filter: "all",
  search: "",
  signedIn: false,
  session: null,
  followedGames: [],
  followedProfiles: [],
  liveUpdates: [],
  preparedMediaFile: null,
  feedLoading: false,
  feedHasMore: true,
  feedOffset: 0,
  feedPageSize: 8,
  activeCommentPostId: "",
  activeCommentsPostId: "",
  commentSubmittingPostId: "",
  replyingToCommentId: "",
  commentsLoadingPostId: "",
  commentsByPost: {},
  commentsErrorByPost: {},
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

const els = {
  followedGamesPanel: document.querySelector("#followed-games-panel"),
  serverList: document.querySelector("#server-list"),
  serverCount: document.querySelector("#server-count"),
  feedList: document.querySelector("#feed-list"),
  livePanel: document.querySelector("#live-panel"),
  liveStack: document.querySelector("#live-stack"),
  search: document.querySelector("#global-search"),
  filterButtons: document.querySelectorAll(".filter-chip"),
  composerText: document.querySelector("#composer-text"),
  composerMentionSuggestions: document.querySelector("#composer-mention-suggestions"),
  composerServer: document.querySelector("#composer-server"),
  composerFile: document.querySelector("#composer-file"),
  composerMedia: document.querySelector("#composer-media"),
  composerFileName: document.querySelector("#composer-file-name"),
  composerClearFile: document.querySelector("#composer-clear-file"),
  publishPost: document.querySelector("#publish-post"),
  openComposer: document.querySelector("#open-composer"),
  composer: document.querySelector("#composer"),
  verificationModal: document.querySelector("#verification-modal"),
  verificationSteps: document.querySelector("#verification-steps"),
  verificationFeedback: document.querySelector("#verification-feedback"),
  verificationPrimary: document.querySelector("#verification-primary"),
  verificationClose: document.querySelector("#verification-close"),
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

function normalizeFollowedProfile(profile) {
  if (!profile?.id || !profile.username) return null;
  return {
    id: profile.id,
    displayName: profile.display_name || profile.username || "Usuário Gimerr",
    username: profile.username,
    avatarUrl: profile.avatar_url || "",
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

function getComposerAccept() {
  return "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
}

function getPostTypeFromFile(file) {
  if (isVideoFile(file)) return "video";
  return "post";
}

function validateComposerFile(file) {
  if (!file) return true;
  if (isVideoFile(file)) {
    if (isMobileVideoUploadDevice()) {
      window.alert("O upload de vídeos pode ser feito apenas através de um PC/Mac.");
      return false;
    }
    return true;
  }

  if (!isImageFile(file)) {
    window.alert("Selecione uma imagem JPG, PNG, WebP, GIF ou um vídeo MP4, WebM ou MOV.");
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

function openVerificationModal(status = {}) {
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

function renderPostActions(post) {
  const postId = escapeHtml(post.id);
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
    .slice(0, 5)
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
      <button class="video-lazy-button media-frame" type="button" data-video-post-id="${escapeHtml(post.id || "")}" data-video-src="${escapeHtml(item.url)}" data-video-type="${escapeHtml(item.mediaType || "video/mp4")}" ${poster ? `data-video-poster="${escapeHtml(poster)}"` : ""} aria-label="Reproduzir vídeo">
        ${poster ? `<img class="video-lazy-poster" src="${escapeHtml(poster)}" alt="">` : `<span class="video-lazy-empty">Vídeo</span>`}
        <span class="video-lazy-play" aria-hidden="true"></span>
      </button>
      <span class="video-view-counter" data-video-view-count data-post-id="${escapeHtml(post.id || "")}">${escapeHtml(formatVideoViewCount(post.videoViewCount))}</span>
    </div>
  `;
}

function renderPostMedia(post) {
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

async function loadFollowedProfiles() {
  if (!state.session?.user) {
    state.followedProfiles = [];
    return;
  }
  const client = await window.GimerrAuth.getClient();
  const { data: follows, error: followsError } = await client
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", state.session.user.id)
    .order("created_at", { ascending: false })
    .limit(80);

  if (followsError) throw followsError;

  const followedIds = [...new Set((follows || [])
    .map((row) => row.following_id)
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

async function loadFeedPosts({ append = false } = {}) {
  if (state.feedLoading) return;
  const offset = append ? state.feedOffset : 0;
  state.feedLoading = true;
  try {
    const response = await fetch(`/api/posts/feed?limit=${state.feedPageSize}&offset=${offset}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
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

  els.composerText.placeholder = "Compartilhe uma jogada, chame a comunidade para jogar ou fale sobre o que você quiser.";
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

function renderFeed({ prepareVideos = true } = {}) {
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

  if (!filtered.length && state.feedLoading) {
    renderFeedLoading();
    return;
  }

  if (!filtered.length) {
    const loaderHtml = state.feedHasMore
      ? `
        <div class="post-card empty-state">
          Nenhum post neste filtro por enquanto.
          <button class="text-button" type="button" data-feed-load-more ${state.feedLoading ? "disabled" : ""}>
            ${state.feedLoading ? "Carregando..." : "Carregar mais posts"}
          </button>
        </div>
      `
      : `<div class="post-card empty-state">Nada novo por aqui.</div>`;
    els.feedList.innerHTML = loaderHtml;
    return;
  }

  const feedHtml = filtered.map((post) => {
    const game = post.game || getGame(post.gameId);
    const author = post.author || {};
    const authorName = author.displayName || "Usuário Gimerr";
    const authorHandle = author.username ? `@${author.username}` : "@gimerr";
    const media = renderPostMedia(post);
    return `
      <article class="post-card">
        ${media}
        <div class="post-body">
          ${post.type === "listing" ? `<span class="post-marketplace-badge">Anúncio</span>` : ""}
          ${renderMentionLine(authorName, post)}
          <div class="post-meta">
            <a class="author-block" href="${getProfileUrl(author)}">
              <div class="post-avatar">
                <img src="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}" alt="">
              </div>
              <div class="author-copy">
                <strong>${escapeHtml(authorName)}</strong>
                <span>${escapeHtml(authorHandle)} · ${escapeHtml(formatRelativeTime(post.createdAt))}</span>
              </div>
            </a>
            <div class="post-card-tools">
              ${renderPostMenu(post)}
            </div>
          </div>
          <div>
            ${post.body ? `<p class="post-text">${escapeHtml(post.body)}</p>` : ""}
          </div>
          <a class="channel-line" href="${getGameUrl(game)}">
            <span class="channel-game-logo" aria-hidden="true">
              <img src="${escapeHtml(game?.coverUrl || "./assets/avatar.svg")}" alt="">
            </span>
            <span>${escapeHtml(game?.name || "Game")}</span>
          </a>
          ${renderPostActions(post)}
        </div>
      </article>
    `;
  }).join("");
  const loaderHtml = state.feedHasMore
    ? `
      <div class="feed-pagination" data-feed-sentinel>
        <button class="text-button" type="button" data-feed-load-more ${state.feedLoading ? "disabled" : ""}>
          ${state.feedLoading ? "Carregando mais posts..." : "Carregar mais posts"}
        </button>
      </div>
    `
    : "";
  els.feedList.innerHTML = `${feedHtml}${loaderHtml}`;
  if (prepareVideos) window.GimerrVideoPlayer?.prepare(els.feedList);
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
  state.filter = nextFilter;
  els.filterButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.filter === nextFilter);
  });
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

async function createFeedPost({ game, type, text, uploadedMedia }) {
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
  if (!response.ok) {
    const error = new Error(payload.error || "Não foi possível publicar.");
    error.code = payload.code;
    error.discordLinked = payload.discordLinked;
    error.verificationStatus = payload.verificationStatus;
    throw error;
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

  const type = file ? getPostTypeFromFile(file) : "post";
  try {
    const preparedFile = await prepareComposerUploadFile(file, type);
    if (file && !preparedFile) return;
    setPublishing(true, preparedFile ? "Enviando..." : "Publicando...");
    const uploadedMedia = await uploadComposerMedia(preparedFile, type);
    setPublishing(true, "Publicando...");
    await createFeedPost({ game, type, text, uploadedMedia });
    els.composerText.value = "";
    clearComposerFile();
    state.feedOffset = 0;
    state.feedHasMore = true;
    await loadFeedPosts();
    renderFeed();
  } catch (error) {
    console.warn("Não foi possível publicar.", error);
    if (error.code === "account_not_verified") {
      const status = await loadVerificationStatus().catch(() => ({
        discordLinked: Boolean(error.discordLinked),
        verificationStatus: error.verificationStatus || "unverified",
      }));
      openVerificationModal(status);
      return;
    }
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

els.search.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderFeed();
});

els.composerText.addEventListener("input", updateMentionSuggestions);
els.composerText.addEventListener("click", updateMentionSuggestions);
els.composerText.addEventListener("keyup", (event) => {
  if (["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key)) return;
  updateMentionSuggestions();
});
els.composerText.addEventListener("keydown", (event) => {
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

els.composerMentionSuggestions?.addEventListener("mousedown", (event) => {
  const button = event.target instanceof Element
    ? event.target.closest("[data-mention-index]")
    : null;
  if (!button) return;
  event.preventDefault();
  const profile = state.mention.items[Number(button.dataset.mentionIndex || 0)];
  insertMention(profile);
});

els.publishPost.addEventListener("click", publishPost);
els.composerFile.addEventListener("change", renderComposerFile);
els.composerClearFile.addEventListener("click", clearComposerFile);
els.verificationClose.addEventListener("click", closeVerificationModal);
els.verificationSteps.addEventListener("click", async (event) => {
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
els.verificationPrimary.addEventListener("click", async () => {
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

  if (!target.closest("#composer")) {
    closeMentionSuggestions();
  }
});

document.addEventListener("submit", async (event) => {
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

document.addEventListener("click", (event) => {
  const textarea = event.target instanceof Element ? event.target.closest("[data-inline-comment-form] textarea") : null;
  if (textarea) {
    updateCommentMentionSuggestions(textarea);
    return;
  }
  if (!event.target.closest?.("[data-comment-mention-suggestions]")) {
    closeCommentMentionSuggestions();
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

els.openComposer.addEventListener("click", () => {
  if (!state.followedGames.length) return;
  els.composer.scrollIntoView({ behavior: "smooth", block: "start" });
  els.composerText.focus();
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

  await completeDiscordConnectionFromCallback();

  setPublishing(true, "Carregando...");

  const followedPromise = withTimeout(loadFollowedGames(), 12000, "A lista de games demorou mais que o esperado.")
    .catch((error) => {
      console.warn("Não foi possível carregar games seguidos.", error);
      state.followedGames = [];
    })
    .finally(() => {
      renderFollowedGames();
      renderLiveStack();
      setComposerAvailability();
      renderFeed({ prepareVideos: false });
    });

  const followedProfilesPromise = withTimeout(loadFollowedProfiles(), 12000, "A lista de perfis seguidos demorou mais que o esperado.")
    .catch((error) => {
      console.warn("Não foi possível carregar perfis seguidos.", error);
      state.followedProfiles = [];
    });

  const feedPromise = withTimeout(loadFeedPosts(), 12000, "O feed demorou mais que o esperado.")
    .then(() => {
      renderFeed();
    })
    .catch((error) => {
      console.warn("Não foi possível carregar posts do feed.", error);
      posts = [];
      state.feedHasMore = false;
      renderFeed();
    });

  await Promise.allSettled([followedPromise, followedProfilesPromise, feedPromise]);
}

init();
