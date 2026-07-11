(function initGamePage() {
  const state = {
    session: null,
    loading: true,
    game: null,
    followers: [],
    followerCount: 0,
    following: false,
    feed: [],
    filter: "all",
    activeCommentPostId: "",
    activeCommentsPostId: "",
    commentSubmittingPostId: "",
    commentsLoadingPostId: "",
    commentsByPost: {},
    commentsErrorByPost: {},
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

  function renderInlineCommentItem(comment) {
    const author = comment.author || {};
    const authorName = author.displayName || "Usuário Gimerr";
    const authorHandle = author.username ? `@${author.username}` : "";
    return `
      <article class="comment-item inline-comment-item">
        <a class="post-avatar" href="${getProfileUrl(author)}">
          <img src="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}" alt="">
        </a>
        <div class="comment-copy">
          <div class="comment-meta">
            <a href="${getProfileUrl(author)}">${escapeHtml(authorName)}</a>
            <span>${escapeHtml([authorHandle, formatRelativeTime(comment.createdAt)].filter(Boolean).join(" · "))}</span>
          </div>
          <p>${renderTextWithMentions(comment.body, author.username)}</p>
        </div>
      </article>
    `;
  }

  function renderInlineCommentsPanel(post) {
    const postId = String(post.id || "");
    if (String(state.activeCommentsPostId) !== postId) return "";

    const commentState = state.commentsByPost[postId] || { items: [], hasMore: false, nextOffset: 0 };
    const isLoading = String(state.commentsLoadingPostId) === postId;
    const error = state.commentsErrorByPost[postId] || "";
    const comments = commentState.items || [];
    const body = error
      ? `<p class="comments-empty">${escapeHtml(error)}</p>`
      : comments.length
        ? comments.map(renderInlineCommentItem).join("")
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
    const textarea = form.querySelector("textarea");
    const feedback = form.querySelector("[data-inline-comment-feedback]");
    const body = textarea?.value?.trim() || "";
    if (!postId || !body || state.commentSubmittingPostId) {
      textarea?.focus();
      return;
    }

    state.commentSubmittingPostId = postId;
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
        body: JSON.stringify({ postId, body }),
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
      state.activeCommentPostId = "";
    } catch (error) {
      state.activeCommentPostId = postId;
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
      if (String(state.activeCommentPostId) !== String(postId)) renderFeed({ prepareVideos: false });
    }
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
      const mediaUrl = post.mediaUrl || post.image;
      const media = mediaUrl
        ? post.mediaType?.startsWith("video/")
          ? `<video class="media-frame" data-fluid-video src="${escapeHtml(mediaUrl)}" ${post.videoThumbnailUrl ? `poster="${escapeHtml(post.videoThumbnailUrl)}"` : ""} controls playsinline preload="metadata"><source src="${escapeHtml(mediaUrl)}" type="${escapeHtml(post.mediaType || "video/mp4")}"></video>`
          : `<img class="media-frame" src="${escapeHtml(mediaUrl)}" alt="">`
        : "";
      return `
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
                <span>${escapeHtml([authorHandle, formatRelativeTime(post.createdAt || post.time)].filter(Boolean).join(" · "))}</span>
              </div>
            </a>
            <div class="post-card-tools">
              ${renderPostMenu(post)}
            </div>
          </div>
          <div>
            ${post.body || post.text ? `<p class="post-text">${escapeHtml(post.body || post.text)}</p>` : ""}
          </div>
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
    state.loading = false;
    els.layout.classList.remove("is-loading");
    renderGame();
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
      state.activeCommentPostId = String(state.activeCommentPostId) === String(postId) ? "" : postId;
      renderFeed({ prepareVideos: false });
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePostMenus();
  });

  if (!redirectLegacySharedPostUrl()) loadGame();
})();
