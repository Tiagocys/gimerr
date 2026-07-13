(function initPostPage() {
  const state = {
    session: null,
    post: null,
    comments: [],
    commentsError: "",
    commentSubmitting: false,
    replyingToCommentId: "",
    followedProfiles: [],
    commentMention: {
      active: false,
      start: -1,
      end: -1,
      selectedIndex: 0,
      items: [],
    },
  };

  const els = {
    layout: document.querySelector("#post-detail-layout"),
    card: document.querySelector("#post-detail-card"),
  };

  if (!els.layout || !els.card) return;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getPostId() {
    const params = new URLSearchParams(window.location.search);
    const rawId = (params.get("id") || params.get("post") || "").trim();
    return rawId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
  }

  function getProfileUrl(profile) {
    if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
    return `./profile?id=${encodeURIComponent(profile?.id || "")}`;
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

  function formatVideoViewCount(value) {
    const count = Number(value || 0);
    const formatted = new Intl.NumberFormat("pt-BR").format(count);
    return count === 1 ? "1 visualização" : `${formatted} visualizações`;
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
    document.querySelectorAll("[data-comment-mention-suggestions], #comment-mention-suggestions").forEach((container) => {
      container.hidden = true;
      container.innerHTML = "";
    });
  }

  function renderCommentMentionSuggestions() {
    const container = state.commentMention.textarea?.closest("form")?.querySelector("[data-comment-mention-suggestions], #comment-mention-suggestions")
      || document.querySelector("#comment-mention-suggestions");
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
    if (!textarea) return;
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
    const textarea = state.commentMention.textarea || document.querySelector("#comment-body");
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

  function getGameUrl(game) {
    if (!game) return "./game";
    return game.slug
      ? `./game?slug=${encodeURIComponent(game.slug)}`
      : `./game?id=${encodeURIComponent(game.id)}`;
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

  async function sharePost() {
    const post = state.post;
    const title = post?.type === "video"
      ? "Veja este vídeo no Gimerr"
      : "Veja este post no Gimerr";
    const url = window.location.href;

    if (navigator.share) {
      await navigator.share({
        title,
        text: `Publicado em ${post?.game?.name || "Gimerr"}`,
        url,
      });
      return;
    }

    await copyTextToClipboard(url);
    window.alert("Link copiado.");
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

    els.card.innerHTML = `<div class="post-card empty-state">Post apagado.</div>`;
  }

  function renderMissing(message) {
    els.layout.classList.remove("is-loading");
    els.card.innerHTML = `<div class="post-card empty-state">${escapeHtml(message)}</div>`;
  }

  function renderPost() {
    const post = state.post;
    if (!post) return;

    const author = post.author || {};
    const authorName = author.displayName || "Usuário Gimerr";
    const authorHandle = author.username ? `@${author.username}` : "@gimerr";
    const media = renderPostMedia(post);

    document.title = `${authorName} | Gimerr`;
    els.layout.classList.remove("is-loading");
    els.card.innerHTML = `
      <article class="post-card post-detail-post">
        ${media}
        <div class="post-body">
          ${renderMentionLine(authorName, post)}
          ${post.type === "listing" ? `<span class="post-marketplace-badge">Anúncio</span>` : ""}
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
            ${post.body ? `<p class="post-text">${escapeHtml(post.body)}</p>` : ""}
          </div>
          <a class="channel-line" href="${getGameUrl(post.game)}">
            <span class="channel-game-logo" aria-hidden="true">
              <img src="${escapeHtml(post.game?.coverUrl || "./assets/avatar.svg")}" alt="">
            </span>
            <span>Em ${escapeHtml(post.game?.name || "Game")} ${escapeHtml(formatRelativeTime(post.createdAt))}</span>
          </a>
        </div>
      </article>
      ${post.type === "listing" ? "" : renderCommentsSection()}
    `;
    window.GimerrVideoPlayer?.prepare(els.card);
  }

  function renderCommentsSection() {
    const commentCount = state.comments.length;
    const commentsById = buildCommentsById(state.comments);
    const comments = state.commentsError
      ? `<p class="comments-empty">${escapeHtml(state.commentsError)}</p>`
      : state.comments.length
        ? state.comments.map((comment) => renderComment(comment, commentsById)).join("")
        : `<p class="comments-empty">Nenhum comentário ainda.</p>`;
    const form = state.session?.user
      ? `
        <form class="comment-form" id="comment-form" data-comment-form>
          <textarea id="comment-body" maxlength="500" rows="3" placeholder="Escreva um comentário"></textarea>
          <div class="composer-mention-suggestions comment-mention-suggestions" id="comment-mention-suggestions" data-comment-mention-suggestions hidden></div>
          <div class="comment-form-actions">
            <span>Até 500 caracteres.</span>
            <button class="primary-button" type="submit" ${state.commentSubmitting ? "disabled" : ""}>
              ${state.commentSubmitting ? "Comentando..." : "Comentar"}
            </button>
          </div>
          <p class="field-feedback" id="comment-feedback"></p>
        </form>
      `
      : `<a class="text-button comment-login-link" href="./sign-in.html">Entre para comentar</a>`;

    return `
      <section class="comments-panel" aria-labelledby="comments-title">
        <div class="comments-head">
          <h2 id="comments-title">Comentários</h2>
          <span>${commentCount}</span>
        </div>
        ${form}
        <div class="comments-list">
          ${comments}
        </div>
      </section>
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

  function renderReplyForm(comment) {
    if (String(state.replyingToCommentId) !== String(comment.id)) return "";
    if (!state.session?.user) return `<a class="text-button comment-login-link" href="./sign-in.html">Entre para responder</a>`;
    return `
      <form class="comment-form inline-reply-form" data-comment-form data-parent-comment-id="${escapeHtml(comment.id)}">
        <textarea maxlength="500" rows="2" placeholder="Responder comentário">${getReplyMention(comment)}</textarea>
        <div class="composer-mention-suggestions comment-mention-suggestions" data-comment-mention-suggestions hidden></div>
        <div class="comment-form-actions">
          <button class="text-button" type="button" data-comment-reply-cancel>Cancelar</button>
          <button class="primary-button" type="submit" ${state.commentSubmitting ? "disabled" : ""}>
            ${state.commentSubmitting ? "Respondendo..." : "Responder"}
          </button>
        </div>
        <p class="field-feedback" data-comment-feedback></p>
      </form>
    `;
  }

  function renderComment(comment, commentsById) {
    const author = comment.author || {};
    const authorName = author.displayName || "Usuário Gimerr";
    const authorHandle = author.username ? `@${author.username}` : "";
    const canDelete = state.session?.user?.id && String(author.id) === String(state.session.user.id);
    return `
      <div class="comment-thread">
        <article class="comment-item" id="comment-${escapeHtml(comment.id)}">
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
              <button class="text-button comment-reply-button" type="button" data-comment-reply data-comment-id="${escapeHtml(comment.id)}">Responder</button>
              ${canDelete ? `
                <button class="comment-delete-button" type="button" data-comment-delete data-comment-id="${escapeHtml(comment.id)}" aria-label="Apagar comentário" title="Apagar comentário">
                  <img src="./assets/trash.svg" alt="">
                </button>
              ` : ""}
            </div>
            ${renderReplyForm(comment)}
          </div>
        </article>
      </div>
    `;
  }

  async function loadSession() {
    if (!window.GimerrAuth) return;
    const { data } = await window.GimerrAuth.getSession();
    state.session = data.session || null;
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
      .order("created_at", { ascending: false });

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

  async function loadPost() {
    const postId = getPostId();
    if (!postId) {
      renderMissing("Post não encontrado.");
      return;
    }

    const response = await fetch(`/api/posts/detail?id=${encodeURIComponent(postId)}`, {
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      renderMissing(payload.error || "Não foi possível carregar este post.");
      return;
    }

    state.post = payload.post;
    if (state.post?.type !== "listing") {
      await loadComments(postId).catch((error) => {
        console.warn("Não foi possível carregar comentários.", error);
        state.commentsError = error.message || "Não foi possível carregar comentários.";
      });
    }
    renderPost();
  }

  async function loadComments(postId = getPostId()) {
    if (!postId) return;
    const response = await fetch(`/api/posts/comments?postId=${encodeURIComponent(postId)}`, {
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar comentários.");
    state.comments = payload.comments || [];
    state.commentsError = payload.schemaMissing
      ? "Comentários ainda não estão ativos no banco de dados."
      : "";
  }

  async function submitComment(form) {
    if (!state.session?.access_token || !state.post?.id || state.commentSubmitting) return;
    const parentCommentId = form.dataset.parentCommentId || "";
    const textarea = form.querySelector("textarea");
    const feedback = form.querySelector("[data-comment-feedback], #comment-feedback");
    const body = textarea?.value?.trim() || "";
    if (!body) {
      textarea?.focus();
      return;
    }

    state.commentSubmitting = true;
    if (feedback) {
      feedback.textContent = "";
      feedback.className = "field-feedback";
    }
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
        body: JSON.stringify({
          postId: state.post.id,
          parentCommentId: parentCommentId || null,
          body,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível comentar.");

      state.comments = [...state.comments, payload.comment].filter(Boolean);
      textarea.value = "";
      state.replyingToCommentId = "";
      state.commentSubmitting = false;
      renderPost();
    } catch (error) {
      state.commentSubmitting = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Comentar";
      }
      if (feedback) {
        feedback.textContent = error.message || "Não foi possível comentar.";
        feedback.className = "field-feedback is-error";
      } else {
        window.alert(error.message || "Não foi possível comentar.");
      }
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

  async function deleteComment(commentId) {
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
    state.comments = removeCommentsFromList(state.comments, deletedIds);
    if (deletedIds.map(String).includes(String(state.replyingToCommentId))) {
      state.replyingToCommentId = "";
    }
    renderPost();
  }

  document.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target) return;

    const menuToggle = target.closest("[data-post-menu-toggle]");
    if (menuToggle) {
      event.preventDefault();
      togglePostMenu(menuToggle);
      return;
    }

    const shareButton = target.closest("[data-post-share]");
    if (shareButton) {
      event.preventDefault();
      closePostMenus();
      try {
        await sharePost();
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.warn("Não foi possível compartilhar post.", error);
        window.alert("Não foi possível compartilhar este post.");
      }
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

    const mentionButton = target.closest("[data-comment-mention-index]");
    if (mentionButton) {
      event.preventDefault();
      const profile = state.commentMention.items[Number(mentionButton.dataset.commentMentionIndex || 0)];
      insertCommentMention(profile);
      return;
    }

    const commentDeleteButton = target.closest("[data-comment-delete]");
    if (commentDeleteButton) {
      event.preventDefault();
      try {
        await deleteComment(commentDeleteButton.dataset.commentId || "");
      } catch (error) {
        console.warn("Não foi possível apagar comentário.", error);
        window.alert(error.message || "Não foi possível apagar comentário.");
      }
      return;
    }

    const replyButton = target.closest("[data-comment-reply]");
    if (replyButton) {
      event.preventDefault();
      const commentId = replyButton.dataset.commentId || "";
      state.replyingToCommentId = String(state.replyingToCommentId) === String(commentId) ? "" : commentId;
      renderPost();
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
      renderPost();
      return;
    }

    if (!target.closest("[data-post-menu]")) {
      closePostMenus();
    }

    if (!target.closest("#comment-form")) {
      closeCommentMentionSuggestions();
    }
  });

  document.addEventListener("input", (event) => {
    const textarea = event.target instanceof Element ? event.target.closest("[data-comment-form] textarea") : null;
    if (!textarea) return;
    updateCommentMentionSuggestions(textarea);
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target instanceof Element ? event.target.closest("[data-comment-form]") : null;
    if (!form) return;
    event.preventDefault();
    await submitComment(form);
  });

  document.addEventListener("keydown", (event) => {
    const textarea = event.target instanceof Element ? event.target.closest("[data-comment-form] textarea") : null;
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
      closePostMenus();
      closeCommentMentionSuggestions();
    }
  });

  document.addEventListener("gimerr:video-view", (event) => {
    const postId = event.detail?.postId;
    const videoViewCount = Number(event.detail?.videoViewCount || 0);
    if (!state.post || String(state.post.id) !== String(postId)) return;
    state.post = { ...state.post, videoViewCount };
  });

  async function init() {
    await loadSession().catch((error) => {
      console.warn("Não foi possível carregar sessão.", error);
    });
    await loadFollowedProfiles().catch((error) => {
      console.warn("Não foi possível carregar perfis seguidos.", error);
      state.followedProfiles = [];
    });
    await loadPost();
  }

  init();
})();
