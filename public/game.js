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

  function renderFeed() {
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
          <div class="post-meta">
            <div class="author-block">
              <div class="post-avatar">
                <img src="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}" alt="">
              </div>
              <div class="author-copy">
                <strong>${escapeHtml(authorName)}</strong>
                <span>${escapeHtml([authorHandle, formatRelativeTime(post.createdAt || post.time)].filter(Boolean).join(" · "))}</span>
              </div>
            </div>
            <div class="post-card-tools">
              ${renderPostMenu(post)}
            </div>
          </div>
          <div>
            <h3 class="post-title">${escapeHtml(post.type === "listing" ? "Anúncio" : post.type === "video" ? "Vídeo" : "Imagem")}</h3>
            ${post.body || post.text ? `<p class="post-text">${escapeHtml(post.body || post.text)}</p>` : ""}
          </div>
        </div>
      </article>
    `;
    }).join("");
    window.GimerrVideoPlayer?.prepare(els.feedList);
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

  if (!redirectLegacySharedPostUrl()) loadGame();
})();
