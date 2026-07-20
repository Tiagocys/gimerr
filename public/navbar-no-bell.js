(function initAccountNavbar() {
  const authLink = document.querySelector(".top-actions .auth-button");
  const accountMenu = document.querySelector("[data-account-menu]");
  const topActions = document.querySelector(".top-actions");
  if (!authLink || !accountMenu || !topActions || !window.GimerrAuth) return;
  const topbar = topActions.closest(".topbar");

  const state = {
    open: false,
    session: null,
    profile: null,
    unreadMessagesCount: 0,
    messagesLoading: false,
    messagesPollTimer: 0,
    navbarPollingPaused: false,
  };

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

  function getDisplayName(user, profile) {
    const metadata = user?.user_metadata || {};
    return profile?.display_name
      || metadata.full_name
      || metadata.name
      || user?.email?.split("@")[0]
      || "Usuário Gimerr";
  }

  function getAvatarUrl(user, profile) {
    const avatarUrl = String(profile?.avatar_url || "");
    if (avatarUrl.includes("googleusercontent.com")) return "./assets/avatar.svg";
    return avatarUrl || "./assets/avatar.svg";
  }

  function getPublicProfileUrl(user, profile) {
    if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
    return `./profile?id=${encodeURIComponent(user.id)}`;
  }

  function setMenuOpen(isOpen) {
    state.open = isOpen;
    accountMenu.classList.toggle("is-open", isOpen);
    accountMenu.querySelector(".account-avatar-button")?.setAttribute("aria-expanded", String(isOpen));
  }

  function setTopbarLoading(isLoading) {
    topbar?.classList.toggle("is-loading", Boolean(isLoading));
    topbar?.setAttribute("aria-busy", String(Boolean(isLoading)));
  }

  function ensureTopbarActionLoader() {
    let loader = topActions.querySelector("[data-topbar-action-loader]");
    if (loader) return loader;

    loader = document.createElement("div");
    loader.className = "topbar-action-loader";
    loader.dataset.topbarActionLoader = "";
    loader.setAttribute("aria-hidden", "true");
    loader.innerHTML = `
      <span></span>
      <span></span>
      <span></span>
    `;
    topActions.insertBefore(loader, authLink);
    return loader;
  }

  function ensureCreateListingButton() {
    let button = topActions.querySelector("[data-create-listing-button]");
    const hasLocalComposer = Boolean(document.querySelector("#composer"));

    if (!button) {
      button = document.createElement("button");
      button.className = "primary-button navbar-create-listing";
      button.type = "button";
      button.dataset.createListingButton = "";
      button.textContent = "+ Criar";
      topActions.insertBefore(button, ensureMessagesLink());
    }

    if (hasLocalComposer) {
      button.id = button.id || "open-composer";
      button.setAttribute("aria-controls", "composer");
      button.setAttribute("aria-expanded", "false");
      return button;
    }

    button.removeAttribute("id");
    button.removeAttribute("aria-controls");
    button.removeAttribute("aria-expanded");

    if (button.dataset.createListingBound !== "true") {
      button.dataset.createListingBound = "true";
      button.addEventListener("click", () => {
        const url = new URL("/", window.location.origin);
        url.searchParams.set("openComposer", "1");
        window.location.assign(url.toString());
      });
    }

    return button;
  }

  function ensureMessagesLink() {
    let link = document.querySelector("[data-messages-link]");
    if (link) {
      topActions.insertBefore(link, accountMenu || authLink);
      return link;
    }

    link = document.createElement("a");
    link.className = "ghost-icon message-nav-link";
    link.href = "./messages.html";
    link.setAttribute("aria-label", "Mensagens");
    link.dataset.messagesLink = "";
    link.innerHTML = `
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 4h16v12H7.8L4 20V4Zm2 2v9.2L7 14h11V6H6Zm3 3h6v2H9V9Zm0 3h8v2H9v-2Z"/>
      </svg>
      <span class="message-badge" data-messages-badge hidden>0</span>
    `;
    topActions.insertBefore(link, accountMenu || authLink);
    return link;
  }

  function renderMessagesBadge() {
    const link = ensureMessagesLink();
    const badge = link.querySelector("[data-messages-badge]");
    if (!badge) return;

    if (state.unreadMessagesCount > 0) {
      badge.hidden = false;
      badge.textContent = state.unreadMessagesCount > 99 ? "99+" : String(state.unreadMessagesCount);
    } else {
      badge.hidden = true;
      badge.textContent = "0";
    }
  }

  function handleUnauthorizedPolling() {
    stopNavbarPolling();
    state.session = null;
    state.profile = null;
    state.unreadMessagesCount = 0;
    state.messagesLoading = false;
    setMenuOpen(false);
    renderMessagesBadge();
    authLink.hidden = false;
    accountMenu.hidden = true;
    ensureMessagesLink().hidden = true;
  }

  async function loadMessagesUnreadCount() {
    if (!state.session?.access_token || state.messagesLoading) return;

    state.messagesLoading = true;
    try {
      const response = await fetch("/api/messages/unread-count", {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${state.session.access_token}`,
        },
      });
      if (response.status === 401) {
        handleUnauthorizedPolling();
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar mensagens.");

      state.unreadMessagesCount = Number(payload.unreadCount || 0);
      renderMessagesBadge();
    } catch (error) {
      console.warn("Não foi possível carregar contador de mensagens.", error);
    } finally {
      state.messagesLoading = false;
    }
  }

  function startMessagesPolling() {
    if (state.navbarPollingPaused) return;
    window.clearInterval(state.messagesPollTimer);
    state.messagesPollTimer = window.setInterval(() => {
      if (!document.hidden) {
        loadMessagesUnreadCount();
      }
    }, 15000);
  }

  function stopNavbarPolling() {
    state.navbarPollingPaused = true;
    window.clearInterval(state.messagesPollTimer);
    state.messagesPollTimer = 0;
  }

  window.addEventListener("gimerr:messages-read", () => {
    loadMessagesUnreadCount();
  });

  window.addEventListener("gimerr:messages-page-stale", () => {
    stopNavbarPolling();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !state.navbarPollingPaused) {
      loadMessagesUnreadCount();
    }
  });

  async function signOut() {
    const client = await window.GimerrAuth.getClient();
    await client.auth.signOut();
    window.location.assign("./sign-in.html");
  }

  function renderMenu() {
    const user = state.session?.user;
    const displayName = getDisplayName(user, state.profile);
    const avatarUrl = getAvatarUrl(user, state.profile);
    const initials = getInitials(displayName);
    const profileUrl = getPublicProfileUrl(user, state.profile);

    authLink.hidden = true;
    accountMenu.hidden = false;
    ensureMessagesLink().hidden = false;
    accountMenu.innerHTML = `
      <button class="account-avatar-button" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Abrir menu da conta">
        <img src="${escapeHtml(avatarUrl || "./assets/avatar.svg")}" alt="${escapeHtml(displayName)}">
      </button>
      <div class="account-dropdown" role="menu">
        <a href="${profileUrl}" role="menuitem">Ver meu perfil</a>
        <a href="./messages.html" role="menuitem">Mensagens</a>
        <a href="./discord-bot.html" role="menuitem">App do Discord</a>
        <a href="./edit-profile.html" role="menuitem">Edição de perfil</a>
        ${Number(state.profile?.is_admin || 0) === 1 ? `<a href="./admin.html" role="menuitem">Admin</a>` : ""}
        <a href="./settings.html" role="menuitem">Configurações</a>
        <button type="button" role="menuitem" disabled>Central de Ads <span>em breve</span></button>
        <button type="button" role="menuitem" data-sign-out>Sair</button>
      </div>
    `;

    accountMenu.querySelector(".account-avatar-button").addEventListener("click", (event) => {
      event.stopPropagation();
      setMenuOpen(!state.open);
    });
    accountMenu.querySelector("[data-sign-out]").addEventListener("click", signOut);
  }

  async function loadProfile(client, userId) {
    const { data } = await client
      .from("profiles")
      .select("display_name, username, avatar_url, is_admin")
      .eq("id", userId)
      .maybeSingle();
    return data;
  }

  async function init() {
    setTopbarLoading(true);
    try {
      ensureCreateListingButton();
      ensureTopbarActionLoader();
      const client = await window.GimerrAuth.getClient();
      const { data } = await window.GimerrAuth.getSession();
      state.session = data.session;

      if (!state.session?.user) {
        authLink.hidden = false;
        accountMenu.hidden = true;
        ensureMessagesLink().hidden = true;
        return;
      }

      state.navbarPollingPaused = false;
      state.profile = await loadProfile(client, state.session.user.id);
      renderMenu();
      window.setTimeout(() => {
        loadMessagesUnreadCount();
      }, 1200);
      startMessagesPolling();
    } catch (error) {
      console.warn("Não foi possível carregar o menu da conta.", error);
      authLink.hidden = false;
      accountMenu.hidden = true;
      ensureMessagesLink().hidden = true;
    } finally {
      setTopbarLoading(false);
    }
  }

  document.addEventListener("click", (event) => {
    if (state.open && !accountMenu.contains(event.target)) setMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMenuOpen(false);
    }
  });

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const isUserAvatar = image.closest(
      ".account-avatar-button, .post-avatar, .profile-avatar-large, .user-search-avatar, .media-lightbox-avatar, .conversation-avatar, .listing-seller-head, .profile-preview-avatar",
    );
    const usesExternalGoogleAvatar = image.currentSrc.includes("googleusercontent.com") || image.src.includes("googleusercontent.com");
    if ((!isUserAvatar && !usesExternalGoogleAvatar) || image.dataset.avatarFallbackApplied === "true") return;
    image.dataset.avatarFallbackApplied = "true";
    image.src = "./assets/avatar.svg";
  }, true);

  setTopbarLoading(true);
  ensureCreateListingButton();
  ensureTopbarActionLoader();
  init();
})();
