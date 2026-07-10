(function initPostPage() {
  const state = {
    session: null,
    post: null,
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
    return (params.get("id") || params.get("post") || "").trim();
  }

  function getProfileUrl(profile) {
    if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
    return `./profile?id=${encodeURIComponent(profile?.id || "")}`;
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

  function typeLabel(type) {
    if (type === "video") return "Vídeo";
    if (type === "listing") return "Marketplace";
    return "Imagem";
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
    const media = post.mediaUrl
      ? post.mediaType?.startsWith("video/")
        ? `<video class="media-frame" data-fluid-video src="${escapeHtml(post.mediaUrl)}" ${post.videoThumbnailUrl ? `poster="${escapeHtml(post.videoThumbnailUrl)}"` : ""} controls playsinline preload="metadata"><source src="${escapeHtml(post.mediaUrl)}" type="${escapeHtml(post.mediaType || "video/mp4")}"></video>`
        : `<img class="media-frame" src="${escapeHtml(post.mediaUrl)}" alt="">`
      : "";

    document.title = `${typeLabel(post.type)} de ${authorName} | Gimerr`;
    els.layout.classList.remove("is-loading");
    els.card.innerHTML = `
      <article class="post-card post-detail-post">
        ${media}
        <div class="post-body">
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
            <h1 class="post-title">${escapeHtml(typeLabel(post.type))}</h1>
            ${post.body ? `<p class="post-text">${escapeHtml(post.body)}</p>` : ""}
          </div>
          <a class="channel-line" href="${getGameUrl(post.game)}">
            <span class="channel-dot" aria-hidden="true"></span>
            <span>${escapeHtml(post.game?.name || "Game")}</span>
          </a>
        </div>
      </article>
    `;
    window.GimerrVideoPlayer?.prepare(els.card);
  }

  async function loadSession() {
    if (!window.GimerrAuth) return;
    const { data } = await window.GimerrAuth.getSession();
    state.session = data.session || null;
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

    if (!target.closest("[data-post-menu]")) {
      closePostMenus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePostMenus();
  });

  async function init() {
    await loadSession().catch((error) => {
      console.warn("Não foi possível carregar sessão.", error);
    });
    await loadPost();
  }

  init();
})();
