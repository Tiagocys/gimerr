(async function initMessagesPage() {
  const layout = document.querySelector("#messages-layout");
  const list = document.querySelector("#conversation-list");
  const threadHead = document.querySelector("#message-thread-head");
  const title = document.querySelector("#thread-title");
  const subtitle = document.querySelector("#thread-subtitle");
  const threadBody = document.querySelector("#message-thread-body");
  const threadAvatar = document.querySelector("#thread-avatar");
  const threadProfileLink = document.querySelector("#thread-profile-link");
  const input = document.querySelector("#message-input");
  const sendButton = document.querySelector("#message-send");
  const attachButton = document.querySelector("#message-attach");
  const attachmentInput = document.querySelector("#message-attachment-input");
  const attachmentPreview = document.querySelector("#message-attachment-preview");
  const searchInput = document.querySelector("#conversation-search");
  const typeTabsWrap = document.querySelector("#messages-type-tabs");
  const typeTabs = document.querySelectorAll("[data-conversation-type]");
  const marketplaceUnreadCount = document.querySelector("#marketplace-unread-count");
  const friendsUnreadCount = document.querySelector("#friends-unread-count");
  const spamUnreadCount = document.querySelector("#spam-unread-count");
  const staleAlert = document.querySelector("#messages-stale-alert");

  const STALE_TIMEOUT_MS = 5 * 60 * 1000;
  const MAX_ATTACHMENT_SOURCE_BYTES = 10 * 1024 * 1024;
  const MAX_ATTACHMENT_UPLOAD_BYTES = 3 * 1024 * 1024;
  const ATTACHMENT_MAX_DIMENSION = 1600;
  const ATTACHMENT_WEBP_QUALITY = 0.82;

  const state = {
    session: null,
    conversations: [],
    activeConversationId: "",
    messages: [],
    readByOthersAt: "",
    loadingThread: false,
    refreshingConversations: false,
    refreshingThread: false,
    sending: false,
    attachmentUploading: false,
    attachment: null,
    filter: "",
    typeFilter: "listing",
    pollTimer: 0,
    lastActivityAt: Date.now(),
    lastConversationRefreshAt: 0,
    pollingStoppedByStale: false,
    threadDragDepth: 0,
    postPreviewCache: new Map(),
    postPreviewLoadingIds: new Set(),
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatRelativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const diff = Date.now() - date.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return "Agora";
    if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))} min`;
    if (diff < day) return `${Math.floor(diff / hour)} h`;
    return `${Math.floor(diff / day)} d`;
  }

  function makeTempId() {
    return `temp-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  }

  function getAvatar(profile) {
    return profile?.avatarUrl || "./assets/avatar.svg";
  }

  function getProfileUrl(profile) {
    if (!profile?.id && !profile?.username) return "./profile.html";
    if (profile.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
    return `./profile?id=${encodeURIComponent(profile.id)}`;
  }

  function getConversationPerson(conversation) {
    const other = conversation?.otherParticipants?.[0] || null;
    return {
      profile: other,
      displayName: other?.displayName || conversation?.title || "Usuário Gimerr",
      username: other?.username || "",
      avatarUrl: getAvatar(other),
    };
  }

  function getConversationContext(conversation) {
    if (conversation?.spam) return "Spam";
    if (conversation?.listing?.gameName) return `Anúncio em ${conversation.listing.gameName}`;
    if (conversation?.type === "listing") return "Conversa do Marketplace";
    return "Conversa";
  }

  function isMessageReadByOthers(message) {
    if (!message?.isOwn || message.pending) return false;
    if (message.readByOthers) return true;
    const readAt = state.readByOthersAt ? new Date(state.readByOthersAt) : null;
    const createdAt = new Date(message.createdAt || "");
    return readAt
      && !Number.isNaN(readAt.getTime())
      && !Number.isNaN(createdAt.getTime())
      && readAt >= createdAt;
  }

  function getMessageDeliveryStatus(message) {
    if (!message?.isOwn) return null;
    if (message.pending) {
      return { icon: "./assets/check.svg", label: "Enviada", className: "is-sent" };
    }
    if (isMessageReadByOthers(message)) {
      return { icon: "./assets/blue-double-check.svg", label: "Visualizada", className: "is-read" };
    }
    return { icon: "./assets/double-check.svg", label: "Entregue", className: "is-delivered" };
  }

  function canDeleteMessage(message) {
    return Boolean(message?.isOwn && !message.pending && !isMessageReadByOthers(message));
  }

  function renderMessageMeta(message) {
    const status = getMessageDeliveryStatus(message);
    return `
      <span class="message-bubble-meta">
        <span>${escapeHtml(message.pending ? "Enviando" : formatRelativeTime(message.createdAt))}</span>
        ${status ? `
          <span class="message-delivery-status ${escapeHtml(status.className)}" title="${escapeHtml(status.label)}" aria-label="${escapeHtml(status.label)}">
            <img src="${escapeHtml(status.icon)}" alt="">
          </span>
        ` : ""}
        ${canDeleteMessage(message) ? `
          <button class="message-delete-button" type="button" data-message-delete="${escapeHtml(message.id)}" aria-label="Apagar mensagem não lida">
            <img src="./assets/trash.svg" alt="">
          </button>
        ` : ""}
      </span>
    `;
  }

  function renderMessageArticle(message) {
    return `
      <article class="message-bubble${message.isOwn ? " is-own" : ""}" id="message-${escapeHtml(message.id)}">
        ${message.mediaUrl ? `<a class="message-image-link" href="${escapeHtml(message.mediaUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(message.mediaUrl)}" alt="Imagem enviada na conversa"></a>` : ""}
        ${renderMessageBody(message)}
        ${renderMessageMeta(message)}
      </article>
    `;
  }

  function isThreadVideoActive() {
    if (!threadBody) return false;
    if (threadBody.querySelector("[data-video-src][data-loading-video='true']")) return true;
    return [...threadBody.querySelectorAll("video[data-fluid-video]")].some((video) => (
      video.dataset.fluidPlayerState === "loading" || !video.paused
    ));
  }

  function updateMessageMetaStatuses() {
    state.messages.forEach((message) => {
      const bubble = document.getElementById(`message-${message.id}`);
      const meta = bubble?.querySelector(".message-bubble-meta");
      if (meta) meta.outerHTML = renderMessageMeta(message);
    });
  }

  function cleanUuid(value) {
    const text = String(value || "").trim();
    return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
  }

  function getPostShareUrl(postId) {
    const url = new URL("/post", window.location.origin);
    url.searchParams.set("id", postId);
    return url.toString();
  }

  function getSharedPostMatches(text) {
    const value = String(text || "");
    const matches = [];
    const seen = new Set();
    const urlPattern = /(https?:\/\/[^\s<>"']+|(?:^|[\s(])\/?post\?id=[0-9a-f-]{36})/gi;
    let match;

    while ((match = urlPattern.exec(value))) {
      const raw = match[0].trim();
      const candidate = raw.startsWith("/post") || raw.startsWith("post")
        ? raw
        : raw.replace(/^[\s(]+/, "");
      let url;
      try {
        url = new URL(candidate, window.location.origin);
      } catch {
        continue;
      }
      const isPostPath = url.pathname.replace(/\/$/, "") === "/post";
      const postId = cleanUuid(url.searchParams.get("id"));
      if (!isPostPath || !postId || seen.has(postId)) continue;
      seen.add(postId);
      matches.push({ id: postId, raw });
    }

    return matches;
  }

  function stripSharedPostUrls(text) {
    let output = String(text || "");
    getSharedPostMatches(output).forEach((match) => {
      output = output.replace(match.raw, "");
    });
    return output.replace(/\n{3,}/g, "\n\n").trim();
  }

  function stripShareIntroText(text) {
    return String(text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => (
        line
        && !/^veja este (vídeo|video|post) no gimerr\.?$/i.test(line)
        && !/^publicado em .+$/i.test(line)
      ))
      .join("\n")
      .trim();
  }

  function renderTextWithLinks(text) {
    const value = String(text || "");
    if (!value) return "";
    const urlPattern = /(https?:\/\/[^\s<>"']+)/gi;
    let output = "";
    let lastIndex = 0;
    let match;

    while ((match = urlPattern.exec(value))) {
      const url = match[0];
      output += escapeHtml(value.slice(lastIndex, match.index));
      output += `<a class="message-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`;
      lastIndex = match.index + url.length;
    }

    output += escapeHtml(value.slice(lastIndex));
    return output.replace(/\n/g, "<br>");
  }

  function getPostMediaItems(post) {
    const items = Array.isArray(post?.mediaItems) ? post.mediaItems.filter((item) => item?.url) : [];
    if (items.length) return items;
    const fallbackUrl = post?.readyMediaUrl || post?.mediaUrl || post?.originalMediaUrl || "";
    return fallbackUrl ? [{ url: fallbackUrl, mediaType: post?.mediaType || "video/mp4" }] : [];
  }

  function isImageMediaItem(item) {
    return String(item?.mediaType || "").startsWith("image/");
  }

  function isVideoMediaItem(item) {
    return String(item?.mediaType || "").startsWith("video/");
  }

  function getPostPreviewTitle(post) {
    const gameName = post?.game?.name || "Gimerr";
    if (post?.type === "video") return `Vídeo em ${gameName}`;
    if (post?.type === "listing") return `Anúncio em ${gameName}`;
    return `Post em ${gameName}`;
  }

  function renderSharedPostPreview(postId) {
    const cached = state.postPreviewCache.get(postId);
    const url = getPostShareUrl(postId);
    if (cached === null) {
      return `<a class="message-post-preview is-unavailable" href="${escapeHtml(url)}">Post indisponível</a>`;
    }
    if (!cached) {
      return `
        <a class="message-post-preview is-loading" href="${escapeHtml(url)}">
          <span>Carregando post compartilhado...</span>
        </a>
      `;
    }

    const post = cached;
    const title = getPostPreviewTitle(post);
    const author = post.author?.displayName || post.author?.username || "Usuário Gimerr";
    const body = stripSharedPostUrls(post.body || "");
    const items = getPostMediaItems(post);
    const [firstItem] = items;
    const isListing = post.type === "listing";
    const firstListingImage = isListing ? items.find(isImageMediaItem) : null;
    const isVideo = !isListing && (post.type === "video" || isVideoMediaItem(firstItem) || String(post.mediaType || "").startsWith("video/"));
    const videoSrc = isVideo ? (post.readyMediaUrl || firstItem?.url || post.mediaUrl || post.originalMediaUrl || "") : "";
    const imageUrl = isListing
      ? firstListingImage?.url || post.game?.coverUrl || ""
      : (!isVideo && firstItem?.url ? firstItem.url : "");
    const poster = isVideo
      ? post.videoThumbnailUrl || post.game?.coverUrl || ""
      : imageUrl;
    const media = isVideo && videoSrc
      ? `
        <button class="video-lazy-button media-frame message-post-video" type="button" data-video-post-id="${escapeHtml(post.id)}" data-video-src="${escapeHtml(videoSrc)}" data-video-type="${escapeHtml(firstItem?.mediaType || post.mediaType || "video/mp4")}" ${poster ? `data-video-poster="${escapeHtml(poster)}"` : ""} aria-label="Reproduzir vídeo compartilhado">
          ${poster ? `<img class="video-lazy-poster" src="${escapeHtml(poster)}" alt="">` : `<span class="video-lazy-empty">Vídeo</span>`}
          <span class="video-lazy-play" aria-hidden="true"></span>
        </button>
      `
      : poster
        ? `<a class="message-post-image" href="${escapeHtml(url)}"><img src="${escapeHtml(poster)}" alt=""></a>`
        : "";

    return `
      <div class="message-post-preview">
        ${media}
        <a class="message-post-preview-copy" href="${escapeHtml(url)}">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(author)}</span>
          ${body ? `<p>${escapeHtml(body)}</p>` : ""}
        </a>
      </div>
    `;
  }

  function renderMessageBody(message) {
    const postMatches = getSharedPostMatches(message.body);
    const text = postMatches.length
      ? stripShareIntroText(stripSharedPostUrls(message.body))
      : stripSharedPostUrls(message.body);
    return `
      ${text ? `<p>${renderTextWithLinks(text)}</p>` : ""}
      ${postMatches.map((match) => renderSharedPostPreview(match.id)).join("")}
    `;
  }

  async function loadPostPreview(postId) {
    if (!postId || state.postPreviewCache.has(postId) || state.postPreviewLoadingIds.has(postId)) return;
    state.postPreviewLoadingIds.add(postId);
    try {
      const response = await fetch(`/api/posts/detail?id=${encodeURIComponent(postId)}`, {
        headers: { accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      state.postPreviewCache.set(postId, response.ok ? payload.post : null);
    } catch (error) {
      console.warn("Não foi possível carregar preview do post.", error);
      state.postPreviewCache.set(postId, null);
    } finally {
      state.postPreviewLoadingIds.delete(postId);
    }

    if (isThreadVideoActive()) return;
    if (state.messages.some((message) => getSharedPostMatches(message.body).some((match) => match.id === postId))) {
      renderThread({ preserveScroll: true });
    }
  }

  function queuePostPreviewLoads() {
    const ids = new Set();
    state.messages.forEach((message) => {
      getSharedPostMatches(message.body).forEach((match) => ids.add(match.id));
    });
    ids.forEach((postId) => {
      if (!state.postPreviewCache.has(postId)) loadPostPreview(postId);
    });
  }

  function getUsernameLabel(username) {
    return username ? `@${username}` : "";
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${state.session.access_token}`,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Falha ao carregar mensagens.");
    return data;
  }

  function setComposerEnabled(enabled) {
    if (input) input.disabled = !enabled || state.sending;
    if (sendButton) sendButton.disabled = !enabled || state.sending;
    if (attachButton) attachButton.disabled = !enabled || state.sending || state.attachmentUploading;
  }

  function setThreadHeadLoading(isLoading) {
    threadHead?.classList.toggle("is-loading", Boolean(isLoading));
  }

  function setTypeTabsLoading(isLoading) {
    typeTabsWrap?.classList.toggle("is-loading", Boolean(isLoading));
  }

  function renderEmptyThread(message = "Selecione uma conversa para começar.") {
    setThreadHeadLoading(false);
    title.textContent = "Mensagens";
    subtitle.textContent = "Converse com usuários do Gimerr.";
    if (threadAvatar) threadAvatar.src = "./assets/avatar.svg";
    if (threadProfileLink) threadProfileLink.hidden = true;
    threadBody.innerHTML = `
      <article class="message-bubble is-system">
        <p>${escapeHtml(message)}</p>
      </article>
    `;
    setComposerEnabled(false);
  }

  function getUnreadCountByType(type) {
    return state.conversations.filter((conversation) => {
      if (type === "spam") return conversation.spam && conversation.unread;
      return !conversation.spam && conversation.type === type && conversation.unread;
    }).length;
  }

  function updateUnreadBadge(element, count) {
    if (!element) return;
    element.hidden = count < 1;
    element.textContent = count > 99 ? "99+" : String(count);
  }

  function renderConversationTypeTabs() {
    typeTabs.forEach((tab) => {
      const isActive = tab.dataset.conversationType === state.typeFilter;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });
    updateUnreadBadge(marketplaceUnreadCount, getUnreadCountByType("listing"));
    updateUnreadBadge(friendsUnreadCount, getUnreadCountByType("direct"));
    updateUnreadBadge(spamUnreadCount, getUnreadCountByType("spam"));
  }

  function renderConversationList() {
    const filter = state.filter.trim().toLowerCase();
    renderConversationTypeTabs();
    const typedConversations = state.conversations.filter((conversation) => {
      if (state.typeFilter === "spam") return conversation.spam;
      return !conversation.spam && conversation.type === state.typeFilter;
    });
    const conversations = filter
      ? typedConversations.filter((conversation) => {
        const participants = conversation.otherParticipants || [];
        const searchable = [
          conversation.title,
          conversation.subtitle,
          conversation.listing?.gameName,
          ...participants.map((profile) => `${profile.displayName} ${profile.username}`),
        ].join(" ").toLowerCase();
        return searchable.includes(filter);
      })
      : typedConversations;

    if (!conversations.length) {
      const emptyLabel = state.typeFilter === "listing"
        ? "Nenhuma conversa do Marketplace ainda."
        : state.typeFilter === "spam"
          ? "Nenhuma conversa na caixa de spam."
          : "Nenhuma conversa com amigos ainda.";
      list.innerHTML = `<p class="messages-empty">${filter ? "Nenhuma conversa encontrada." : emptyLabel}</p>`;
      return;
    }

    list.innerHTML = conversations.map((conversation) => {
      const person = getConversationPerson(conversation);
      const context = getConversationContext(conversation);
      const usernameLabel = getUsernameLabel(person.username);
      const preview = conversation.subtitle || "Sem mensagens ainda.";
      return `
        <button class="conversation-item${conversation.id === state.activeConversationId ? " is-active" : ""}${conversation.unread ? " is-unread" : ""}" type="button" data-conversation-id="${escapeHtml(conversation.id)}">
          <span class="conversation-avatar">
            <img src="${escapeHtml(person.avatarUrl)}" alt="">
          </span>
          <span class="conversation-copy">
            <strong>${escapeHtml(person.displayName)}</strong>
            ${usernameLabel ? `<small class="conversation-username">${escapeHtml(usernameLabel)}</small>` : ""}
            <span>${escapeHtml(`${context} · ${preview}`)}</span>
          </span>
          <small class="conversation-time">${escapeHtml(formatRelativeTime(conversation.lastMessageAt))}</small>
        </button>
      `;
    }).join("");
  }

  function renderThreadLoading() {
    setThreadHeadLoading(true);
    threadBody.innerHTML = `
      <article class="message-bubble is-system">
        <p>Carregando conversa...</p>
      </article>
    `;
    setComposerEnabled(false);
  }

  function renderThread({ preserveScroll = false } = {}) {
    const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
    if (!conversation) {
      renderEmptyThread("Abra uma conversa a partir de um anúncio ou perfil.");
      return;
    }

    const person = getConversationPerson(conversation);
    const usernameLabel = getUsernameLabel(person.username);
    const context = getConversationContext(conversation);
    if (threadAvatar) threadAvatar.src = person.avatarUrl;
    if (threadProfileLink) {
      threadProfileLink.hidden = !person.profile?.id;
      threadProfileLink.href = getProfileUrl(person.profile);
    }
    title.textContent = person.displayName;
    subtitle.textContent = [usernameLabel, context].filter(Boolean).join(" · ") || "Conversa do Gimerr";
    setThreadHeadLoading(false);

    if (!state.messages.length) {
      threadBody.innerHTML = `
        <article class="message-bubble is-system">
          <p>Conversa iniciada. Envie a primeira mensagem.</p>
        </article>
      `;
      setComposerEnabled(true);
      return;
    }

    const shouldStickToBottom = preserveScroll
      ? threadBody.scrollHeight - threadBody.scrollTop - threadBody.clientHeight < 120
      : true;
    threadBody.innerHTML = `
      <div class="message-day-divider">Conversa</div>
      ${state.messages.map(renderMessageArticle).join("")}
    `;
    setComposerEnabled(true);
    queuePostPreviewLoads();
    window.GimerrVideoPlayer?.prepare(threadBody);
    requestAnimationFrame(() => {
      if (shouldStickToBottom) threadBody.scrollTop = threadBody.scrollHeight;
    });
  }

  function getConversationSignature(conversations) {
    return conversations.map((conversation) => `${conversation.id}:${conversation.lastMessageAt}:${conversation.unread}`).join("|");
  }

  function getLatestMessageCreatedAt() {
    return state.messages.at(-1)?.createdAt || "";
  }

  function markActivity() {
    if (state.pollingStoppedByStale) return;
    state.lastActivityAt = Date.now();
  }

  function notifyMessagesRead() {
    window.dispatchEvent(new CustomEvent("gimerr:messages-read"));
  }

  function pausePagePolling() {
    if (state.pollingStoppedByStale) return;
    state.pollingStoppedByStale = true;
    stopPolling();
    if (staleAlert) staleAlert.hidden = false;
    window.dispatchEvent(new CustomEvent("gimerr:messages-page-stale"));
  }

  function shouldPauseForStaleWindow() {
    return Date.now() - state.lastActivityAt >= STALE_TIMEOUT_MS;
  }

  async function loadConversations({ silent = false } = {}) {
    if (state.refreshingConversations) return;
    state.refreshingConversations = true;
    const previousSignature = getConversationSignature(state.conversations);
    if (!silent) list.innerHTML = `<p class="messages-empty">Carregando conversas...</p>`;
    try {
      const data = await api("/api/messages/conversations");
      state.conversations = data.conversations || [];
      state.lastConversationRefreshAt = Date.now();
      setTypeTabsLoading(false);
      const nextSignature = getConversationSignature(state.conversations);
      if (!silent || previousSignature !== nextSignature) renderConversationList();
    } finally {
      state.refreshingConversations = false;
    }
  }

  async function loadThread(conversationId) {
    if (!conversationId || state.loadingThread) return;
    const isChangingConversation = state.activeConversationId !== conversationId;
    if (isChangingConversation) window.GimerrVideoPlayer?.stopAll?.(threadBody);
    state.activeConversationId = conversationId;
    if (isChangingConversation) resetComposer();
    const selectedConversation = state.conversations.find((item) => item.id === conversationId);
    if (selectedConversation?.spam) state.typeFilter = "spam";
    else if (selectedConversation?.type) state.typeFilter = selectedConversation.type;
    state.loadingThread = true;
    state.messages = [];
    renderConversationList();
    renderThreadLoading();
    try {
      const data = await api(`/api/messages/thread?conversationId=${encodeURIComponent(conversationId)}`);
      state.messages = data.messages || [];
      state.readByOthersAt = data.readByOthersAt || "";
      const conversation = state.conversations.find((item) => item.id === conversationId);
      if (conversation) conversation.unread = false;
      renderConversationList();
      renderThread();
      notifyMessagesRead();
    } catch (error) {
      console.warn("Não foi possível carregar conversa.", error);
      renderEmptyThread(error.message || "Não foi possível carregar esta conversa.");
    } finally {
      state.loadingThread = false;
    }
  }

  async function refreshActiveThread() {
    if (!state.activeConversationId || state.loadingThread || state.refreshingThread || state.sending) return;
    state.refreshingThread = true;
    try {
      const params = new URLSearchParams({ conversationId: state.activeConversationId });
      const after = getLatestMessageCreatedAt();
      if (after) params.set("after", after);
      const data = await api(`/api/messages/latest?${params.toString()}`);
      const nextMessages = data.messages || [];
      const previousReadByOthersAt = state.readByOthersAt;
      state.readByOthersAt = data.readByOthersAt || state.readByOthersAt || "";
      if (nextMessages.length) {
        markActivity();
        const existingIds = new Set(state.messages.map((message) => message.id));
        state.messages = [
          ...state.messages,
          ...nextMessages.filter((message) => !existingIds.has(message.id)),
        ];
        const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
        if (conversation) {
          const lastMessage = state.messages.at(-1);
          conversation.unread = false;
          conversation.subtitle = lastMessage?.body || conversation.subtitle;
          conversation.lastMessageAt = lastMessage?.createdAt || conversation.lastMessageAt;
        }
        renderConversationList();
        if (isThreadVideoActive()) {
          threadBody.insertAdjacentHTML("beforeend", nextMessages.map(renderMessageArticle).join(""));
          queuePostPreviewLoads();
          window.GimerrVideoPlayer?.prepare(threadBody);
          requestAnimationFrame(() => {
            threadBody.scrollTop = threadBody.scrollHeight;
          });
        } else {
          renderThread();
        }
        notifyMessagesRead();
      } else if (state.readByOthersAt !== previousReadByOthersAt) {
        if (isThreadVideoActive()) updateMessageMetaStatuses();
        else renderThread({ preserveScroll: true });
      }
    } catch (error) {
      console.warn("Não foi possível atualizar conversa.", error);
    } finally {
      state.refreshingThread = false;
    }
  }

  function getPollingDelay() {
    const idleFor = Date.now() - state.lastActivityAt;
    if (idleFor < 30000) return 3000;
    if (idleFor < 120000) return 8000;
    return 15000;
  }

  function stopPolling() {
    window.clearTimeout(state.pollTimer);
    state.pollTimer = 0;
  }

  function scheduleNextPoll() {
    stopPolling();
    if (document.hidden || state.pollingStoppedByStale) return;
    state.pollTimer = window.setTimeout(async () => {
      if (shouldPauseForStaleWindow()) {
        pausePagePolling();
        return;
      }
      try {
        if (Date.now() - state.lastConversationRefreshAt > 30000) {
          await loadConversations({ silent: true });
        }
        await refreshActiveThread();
      } catch (error) {
        console.warn("Não foi possível atualizar mensagens.", error);
      } finally {
        scheduleNextPoll();
      }
    }, getPollingDelay());
  }

  function startPolling() {
    if (state.pollingStoppedByStale) return;
    scheduleNextPoll();
  }

  async function startFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const conversationId = params.get("conversationId");
    const listingPostId = params.get("listingPostId");
    const recipientId = params.get("recipientId");
    if (conversationId) return conversationId;
    if (!listingPostId && !recipientId) return "";

    const data = await api("/api/messages/start", {
      method: "POST",
      body: JSON.stringify({ listingPostId, recipientId }),
    });
    const nextUrl = new URL(window.location.href);
    nextUrl.search = "";
    nextUrl.searchParams.set("conversationId", data.conversationId);
    window.history.replaceState({}, "", nextUrl.toString());
    return data.conversationId;
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Não foi possível preparar a imagem."));
      };
      image.src = url;
    });
  }

  async function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function compressAttachmentImage(file) {
    if (!file?.type?.startsWith("image/")) throw new Error("Envie uma imagem válida.");
    if (file.size > MAX_ATTACHMENT_SOURCE_BYTES) throw new Error("A imagem original deve ter no máximo 10 MB.");

    const image = await loadImageFromFile(file);
    const ratio = Math.min(1, ATTACHMENT_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Não foi possível comprimir a imagem.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    let blob = await canvasToBlob(canvas, "image/webp", ATTACHMENT_WEBP_QUALITY);
    if (!blob) throw new Error("Não foi possível comprimir a imagem.");
    if (blob.size > MAX_ATTACHMENT_UPLOAD_BYTES) {
      blob = await canvasToBlob(canvas, "image/webp", 0.68);
    }
    if (!blob || blob.size > MAX_ATTACHMENT_UPLOAD_BYTES) {
      throw new Error("A imagem comprimida ainda ficou acima de 3 MB. Use uma imagem menor.");
    }

    const baseName = (file.name || "imagem").replace(/\.[^.]+$/, "") || "imagem";
    return new File([blob], `${baseName}.webp`, { type: "image/webp" });
  }

  function clearAttachment() {
    if (state.attachment?.previewUrl) URL.revokeObjectURL(state.attachment.previewUrl);
    state.attachment = null;
    if (attachmentInput) attachmentInput.value = "";
    if (attachmentPreview) {
      attachmentPreview.hidden = true;
      attachmentPreview.innerHTML = "";
    }
  }

  function resetComposer() {
    if (input) input.value = "";
    clearAttachment();
    state.threadDragDepth = 0;
    setThreadDragActive(false);
    setComposerEnabled(Boolean(state.activeConversationId));
  }

  function renderAttachmentPreview(file) {
    if (!attachmentPreview || !file) return;
    const previewUrl = URL.createObjectURL(file);
    state.attachment = { file, previewUrl };
    attachmentPreview.hidden = false;
    attachmentPreview.innerHTML = `
      <img src="${escapeHtml(previewUrl)}" alt="Imagem anexada">
      <button class="ghost-icon" type="button" data-clear-message-attachment aria-label="Remover imagem">×</button>
    `;
  }

  async function prepareAttachmentFile(file) {
    if (!file) return;
    try {
      clearAttachment();
      const compressed = await compressAttachmentImage(file);
      renderAttachmentPreview(compressed);
      setComposerEnabled(Boolean(state.activeConversationId));
      input?.focus();
    } catch (error) {
      clearAttachment();
      window.alert(error.message || "Não foi possível preparar a imagem.");
    }
  }

  function getDraggedImageFile(dataTransfer) {
    const files = Array.from(dataTransfer?.files || []);
    return files.find((file) => file.type?.startsWith("image/")) || null;
  }

  function setThreadDragActive(isActive) {
    threadBody?.classList.toggle("is-dragging-image", Boolean(isActive));
  }

  async function uploadAttachmentIfNeeded() {
    if (!state.attachment?.file) return { mediaUrl: "", mediaKey: "", mediaType: "" };
    state.attachmentUploading = true;
    setComposerEnabled(Boolean(state.activeConversationId));
    const formData = new FormData();
    formData.append("conversationId", state.activeConversationId);
    formData.append("file", state.attachment.file);
    const response = await fetch("/api/messages/media-upload", {
      method: "POST",
      headers: {
        authorization: `Bearer ${state.session.access_token}`,
      },
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    state.attachmentUploading = false;
    if (!response.ok) throw new Error(payload.error || "Não foi possível enviar a imagem.");
    return {
      mediaUrl: payload.url || "",
      mediaKey: payload.key || "",
      mediaType: payload.mediaType || "",
    };
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!state.activeConversationId || (!text && !state.attachment?.file) || state.sending) return;
    state.sending = true;
    setComposerEnabled(true);
    let tempId = "";
    try {
      const media = await uploadAttachmentIfNeeded();
      tempId = makeTempId();
      const pendingMessage = {
        id: tempId,
        conversationId: state.activeConversationId,
        body: text,
        mediaUrl: media.mediaUrl,
        mediaType: media.mediaType,
        createdAt: new Date().toISOString(),
        isOwn: true,
        readByOthers: false,
        pending: true,
        author: null,
      };
      state.messages.push(pendingMessage);
      renderThread();
      const data = await api("/api/messages/send", {
        method: "POST",
        body: JSON.stringify({
          conversationId: state.activeConversationId,
          body: text,
          ...media,
        }),
      });
      input.value = "";
      clearAttachment();
      markActivity();
      state.messages = state.messages.map((message) => (
        message.id === tempId ? data.message : message
      ));
      const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
      if (conversation) {
        conversation.subtitle = text || "Imagem enviada";
        conversation.lastMessageAt = data.message.createdAt;
      }
      renderConversationList();
      renderThread();
    } catch (error) {
      if (tempId) state.messages = state.messages.filter((message) => message.id !== tempId);
      renderThread({ preserveScroll: true });
      console.warn("Não foi possível enviar mensagem.", error);
      alert(error.message || "Não foi possível enviar mensagem.");
    } finally {
      state.sending = false;
      state.attachmentUploading = false;
      setComposerEnabled(Boolean(state.activeConversationId));
      input?.focus();
    }
  }

  async function deleteMessage(messageId) {
    if (!messageId || messageId.startsWith("temp-")) return;
    const message = state.messages.find((item) => item.id === messageId);
    if (!canDeleteMessage(message)) return;
    const confirmed = window.confirm("Apagar esta mensagem? Essa ação é irreversível.");
    if (!confirmed) return;

    const response = await fetch("/api/messages/delete", {
      method: "POST",
      headers: {
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messageId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível apagar a mensagem.");

    state.messages = state.messages.filter((item) => item.id !== messageId);
    const conversation = state.conversations.find((item) => item.id === state.activeConversationId);
    if (conversation) {
      const lastMessage = state.messages.at(-1);
      conversation.subtitle = lastMessage?.body || (lastMessage?.mediaUrl ? "Imagem enviada" : "Sem mensagens ainda.");
      conversation.lastMessageAt = lastMessage?.createdAt || conversation.lastMessageAt;
    }
    await loadConversations({ silent: true });
    renderConversationList();
    renderThread({ preserveScroll: true });
  }

  try {
    const { data } = await window.GimerrAuth.getSession();
    if (!data.session?.user) {
      window.location.replace("./sign-in.html");
      return;
    }
    state.session = data.session;
    layout?.classList.remove("is-loading");
    const requestedConversationId = await startFromQuery();
    await loadConversations();
    const targetConversation = state.conversations.find((conversation) => !conversation.spam) || state.conversations[0] || null;
    const targetConversationId = requestedConversationId || targetConversation?.id || "";
    if (targetConversationId) await loadThread(targetConversationId);
    else renderEmptyThread("As conversas iniciadas no Marketplace aparecerão aqui.");
    startPolling();
  } catch (error) {
    console.warn("Não foi possível carregar mensagens.", error);
    renderEmptyThread(error.message || "Não foi possível carregar mensagens.");
  }

  list?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-conversation-id]");
    if (!button) return;
    markActivity();
    loadThread(button.dataset.conversationId);
  });

  threadBody?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-message-delete]");
    if (!button) return;
    event.preventDefault();
    markActivity();
    try {
      await deleteMessage(button.dataset.messageDelete || "");
    } catch (error) {
      console.warn("Não foi possível apagar mensagem.", error);
      window.alert(error.message || "Não foi possível apagar a mensagem.");
    }
  });

  typeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const nextType = tab.dataset.conversationType;
      if (!nextType || nextType === state.typeFilter) return;
      markActivity();
      window.GimerrVideoPlayer?.stopAll?.(threadBody);
      state.typeFilter = nextType;
      renderConversationList();
      const activeConversation = state.conversations.find((conversation) => conversation.id === state.activeConversationId);
      const activeMatchesTab = nextType === "spam"
        ? activeConversation?.spam
        : activeConversation?.type === nextType && !activeConversation?.spam;
      if (activeMatchesTab) return;
      const nextConversation = state.conversations.find((conversation) => (
        nextType === "spam"
          ? conversation.spam
          : conversation.type === nextType && !conversation.spam
      ));
      if (nextConversation) {
        loadThread(nextConversation.id);
      } else {
        state.activeConversationId = "";
        state.messages = [];
        resetComposer();
        renderEmptyThread(nextType === "listing"
          ? "Nenhuma conversa do Marketplace ainda."
          : nextType === "spam"
            ? "Nenhuma conversa na caixa de spam."
          : "Nenhuma conversa com amigos ainda.");
      }
    });
  });

  searchInput?.addEventListener("input", () => {
    markActivity();
    state.filter = searchInput.value;
    renderConversationList();
  });

  sendButton?.addEventListener("click", () => {
    markActivity();
    sendMessage();
  });
  attachButton?.addEventListener("click", () => {
    markActivity();
    attachmentInput?.click();
  });
  attachmentInput?.addEventListener("change", async () => {
    const file = attachmentInput.files?.[0] || null;
    await prepareAttachmentFile(file);
  });
  attachmentPreview?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-clear-message-attachment]")) return;
    clearAttachment();
    setComposerEnabled(Boolean(state.activeConversationId));
  });
  threadBody?.addEventListener("dragenter", (event) => {
    if (!state.activeConversationId || !Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    state.threadDragDepth += 1;
    setThreadDragActive(true);
  });
  threadBody?.addEventListener("dragover", (event) => {
    if (!state.activeConversationId || !Array.from(event.dataTransfer?.types || []).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setThreadDragActive(true);
  });
  threadBody?.addEventListener("dragleave", (event) => {
    if (!state.threadDragDepth) return;
    event.preventDefault();
    state.threadDragDepth = Math.max(0, state.threadDragDepth - 1);
    if (state.threadDragDepth === 0) setThreadDragActive(false);
  });
  threadBody?.addEventListener("drop", async (event) => {
    if (!state.activeConversationId) return;
    event.preventDefault();
    state.threadDragDepth = 0;
    setThreadDragActive(false);
    markActivity();
    const file = getDraggedImageFile(event.dataTransfer);
    if (!file) {
      window.alert("Arraste uma imagem válida para anexar.");
      return;
    }
    await prepareAttachmentFile(file);
  });
  input?.addEventListener("keydown", (event) => {
    markActivity();
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
      return;
    }
    if (state.pollingStoppedByStale) return;
    markActivity();
    loadConversations({ silent: true }).catch(() => {});
    refreshActiveThread().finally(scheduleNextPoll);
  });
  ["click", "pointerdown", "scroll"].forEach((eventName) => {
    document.addEventListener(eventName, markActivity, { passive: true });
  });
  window.addEventListener("beforeunload", () => {
    stopPolling();
  });
})();
