(function initGamePage() {
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
    activeCommentPostId: "",
    activeCommentsPostId: "",
    commentSubmittingPostId: "",
    replyingToCommentId: "",
    commentsLoadingPostId: "",
    commentsByPost: {},
    commentsErrorByPost: {},
    composerPreviewUrls: [],
    composerSelectedFiles: [],
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
    followersButton: document.querySelector("#game-followers-button"),
    followersCount: document.querySelector("#game-followers-count"),
    followersSideCount: document.querySelector("#game-followers-side-count"),
    postsCount: document.querySelector("#game-posts-count"),
    listingsCount: document.querySelector("#game-listings-count"),
    followersList: document.querySelector("#game-followers-list"),
    feedList: document.querySelector("#game-feed-list"),
    filterButtons: document.querySelectorAll("[data-game-feed-filter]"),
    feedSubtitle: document.querySelector("#game-feed-subtitle"),
    composer: document.querySelector("#game-composer"),
    composerText: document.querySelector("#game-composer-text"),
    composerFile: document.querySelector("#game-composer-file"),
    composerMedia: document.querySelector("#game-composer-media"),
    composerFileName: document.querySelector("#game-composer-file-name"),
    composerMediaPreviews: document.querySelector("#game-composer-media-previews"),
    composerClearFile: document.querySelector("#game-composer-clear-file"),
    composerListing: document.querySelector("#game-composer-listing"),
    composerListingHelper: document.querySelector("#game-composer-listing-helper"),
    publishPost: document.querySelector("#game-publish-post"),
    composerFeedback: document.querySelector("#game-composer-feedback"),
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

  function validateComposerFiles(files, type) {
    if (!files.length) return true;
    if (type === "listing") {
      if (files.length > 15) {
        window.alert("Anúncios aceitam até 15 imagens.");
        return false;
      }
      if (files.some((file) => !isImageFile(file))) {
        window.alert("Anúncios aceitam apenas imagens JPG, PNG, WebP ou GIF.");
        return false;
      }
      return true;
    }
    if (files.length > 1) {
      window.alert("Posts comuns aceitam apenas um arquivo.");
      return false;
    }
    const [file] = files;
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

  function getPostTypeFromComposer(files) {
    if (els.composerListing?.checked) return "listing";
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

  async function sharePost(postId) {
    const url = getPostShareUrl(postId);
    const post = state.feed.find((item) => String(item.id) === String(postId));
    const title = post?.type === "video"
      ? `Veja este vídeo no Gimerr`
      : `Veja este post no Gimerr`;

    if (navigator.share) {
      await navigator.share({
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

  function renderPostActions(post) {
    const postId = escapeHtml(post.id);
    if (post.type === "listing") {
      return `
        <div class="post-action-bar post-action-bar--listing">
          <button class="post-action-button" type="button" data-post-share data-post-id="${postId}">
            Compartilhar
          </button>
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
      els.publishPost.textContent = isPublishing ? label : "Publicar";
    }
    if (els.composerText) els.composerText.disabled = isPublishing || !state.session?.user || !state.game;
    if (els.composerFile) els.composerFile.disabled = isPublishing || !state.session?.user || !state.game;
    if (els.composerListing) els.composerListing.disabled = isPublishing || !state.session?.user || !state.game;
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
      setPublishing(true, files.length > 1 ? `Enviando ${index + 1}/${files.length}...` : "Enviando...");
      const uploaded = await uploadComposerMedia(files[index], target);
      uploadedItems.push({
        url: uploaded.url,
        key: uploaded.key,
        mediaType: uploaded.mediaType,
      });
    }
    return uploadedItems;
  }

  async function createGamePost({ type, text, uploadedMediaItems }) {
    const primaryMedia = uploadedMediaItems[0] || null;
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

  function clearComposerFile() {
    revokeComposerPreviewUrls();
    state.composerSelectedFiles = [];
    if (els.composerFile) els.composerFile.value = "";
    if (els.composerMedia) els.composerMedia.hidden = true;
    if (els.composerFileName) els.composerFileName.textContent = "";
    if (els.composerMediaPreviews) els.composerMediaPreviews.innerHTML = "";
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
    if (!els.composerListing?.checked) {
      state.composerSelectedFiles = files.slice(0, 1);
      return;
    }
    const bySignature = new Map(state.composerSelectedFiles.map((file) => [getFileSignature(file), file]));
    files.forEach((file) => {
      if (bySignature.size >= 15) return;
      bySignature.set(getFileSignature(file), file);
    });
    state.composerSelectedFiles = Array.from(bySignature.values()).slice(0, 15);
  }

  function renderComposerFile() {
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
      clearComposerFile();
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

  function syncComposerListingState() {
    const isListing = Boolean(els.composerListing?.checked);
    if (els.composerListingHelper) els.composerListingHelper.hidden = !isListing;
    if (els.composerFile) {
      els.composerFile.multiple = isListing;
      els.composerFile.accept = isListing
        ? "image/jpeg,image/png,image/webp,image/gif"
        : "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
      const files = getComposerFiles();
      const invalidListingSelection = isListing && (
        files.length > 15 || files.some((file) => !isImageFile(file))
      );
      if ((!isListing && state.composerSelectedFiles.length) || invalidListingSelection) {
        clearComposerFile();
      }
    }
  }

  async function publishGamePost() {
    if (!state.session?.user) {
      window.location.assign("./sign-in.html");
      return;
    }
    if (!state.game) return;

    const text = els.composerText?.value?.trim() || "";
    const files = getComposerFiles();
    if (!text && !files.length) {
      els.composerText?.focus();
      return;
    }

    const type = getPostTypeFromComposer(files);
    if (!validateComposerFiles(files, type)) return;

    try {
      setComposerFeedback("");
      setPublishing(true, files.length ? "Enviando..." : "Publicando...");
      const uploadTarget = files.length ? type : "post";
      const uploadedMediaItems = await uploadComposerMediaItems(files, uploadTarget);
      setPublishing(true, "Publicando...");
      await createGamePost({ type, text, uploadedMediaItems });
      if (els.composerText) els.composerText.value = "";
      if (els.composerListing) els.composerListing.checked = false;
      clearComposerFile();
      syncComposerListingState();
      await loadGame();
      setComposerFeedback("Publicado.", "success");
    } catch (error) {
      console.warn("Não foi possível publicar no game.", error);
      if (error.code === "account_not_verified") {
        setComposerFeedback("Verifique sua conta para publicar.", "error");
        return;
      }
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

    state.feed = state.feed.filter((post) => String(post.id) !== String(postId));
    renderFeed();
  }

  function getTaxonomyNames(items, limit = 4) {
    return Array.isArray(items)
      ? items.slice(0, limit).map((item) => item?.abbreviation || item?.name).filter(Boolean)
      : [];
  }

  function setLoading(message) {
    els.title.textContent = message;
    els.description.textContent = "";
    els.feedList.innerHTML = "";
  }

  function setMissing(message) {
    state.loading = false;
    els.layout.classList.remove("is-loading");
    els.title.textContent = "Jogo não encontrado";
    els.description.textContent = message;
    els.followButton.hidden = true;
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

    els.feedSubtitle.textContent = `Conteúdo publicado em ${game.name}.`;
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

  function renderFeed({ prepareVideos = true } = {}) {
    if (state.loading) return;
    const filtered = state.feed.filter((item) => state.filter === "all" || item.type === state.filter);
    const listings = state.feed.filter((item) => item.type === "listing");
    els.postsCount.textContent = formatCount(state.feed.length);
    els.listingsCount.textContent = formatCount(listings.length);

    if (!filtered.length) {
      els.feedList.innerHTML = `<div class="post-card empty-state">${state.filter === "listing" ? "Nenhum anúncio publicado para este jogo." : "Nada novo por aqui."}</div>`;
      return;
    }

    els.feedList.innerHTML = filtered.map((post) => {
      const author = post.author || {};
      const authorName = author.displayName || post.author || "Usuário Gimerr";
      const authorHandle = author.username ? `@${author.username}` : "";
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
                <span>${escapeHtml(authorHandle)}</span>
              </div>
            </a>
            <div class="post-card-tools">
              ${renderPostMenu(post)}
            </div>
          </div>
          <div>
            ${post.body || post.text ? `<p class="post-text">${escapeHtml(post.body || post.text)}</p>` : ""}
          </div>
          <a class="channel-line" href="${getCurrentGameUrl()}">
            <span class="channel-game-logo" aria-hidden="true">
              <img src="${escapeHtml(state.game?.coverUrl || "./assets/avatar.svg")}" alt="">
            </span>
            <span>Em ${escapeHtml(state.game?.name || "Game")} ${escapeHtml(formatRelativeTime(post.createdAt || post.time))}</span>
          </a>
          ${renderPostActions(post)}
        </div>
      </article>
    `;
    }).join("");
    if (prepareVideos) window.GimerrVideoPlayer?.prepare(els.feedList);
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
    await loadFollowedProfiles().catch((error) => {
      console.warn("Não foi possível carregar perfis seguidos para marcações.", error);
      state.followedProfiles = [];
    });
    state.loading = false;
    els.layout.classList.remove("is-loading");
    renderGame();
  }

  async function loadFollowedProfiles() {
    if (!state.session?.user || !window.GimerrAuth) {
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
  els.publishPost?.addEventListener("click", publishGamePost);
  els.composerFile?.addEventListener("change", renderComposerFile);
  els.composerClearFile?.addEventListener("click", clearComposerFile);
  els.composerListing?.addEventListener("change", syncComposerListingState);
  syncComposerListingState();
  els.filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.gameFeedFilter;
      els.filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      renderFeed();
    });
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
    if (event.key === "Escape") closePostMenus();
    if (event.key === "Escape") closeCommentMentionSuggestions();
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
