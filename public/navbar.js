(function initAccountNavbar() {
  const authLink = document.querySelector(".top-actions .auth-button");
  const accountMenu = document.querySelector("[data-account-menu]");
  const topActions = document.querySelector(".top-actions");
  if (!authLink || !accountMenu || !topActions || !window.GimerrAuth) return;

  const state = {
    open: false,
    notificationsOpen: false,
    session: null,
    profile: null,
    notifications: [],
    notificationsLoaded: false,
    notificationsLoading: false,
    unreadCount: 0,
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
    return profile?.avatar_url || "./assets/avatar.svg";
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

  function ensureNotificationMenu() {
    let root = document.querySelector("[data-notifications-menu]");
    if (root) return root;

    const legacyButton = topActions.querySelector('button[aria-label="Notificações"]:not([data-notifications-button])');
    legacyButton?.remove();

    root = document.createElement("div");
    root.className = "notifications-menu";
    root.dataset.notificationsMenu = "";
    root.innerHTML = `
      <button class="ghost-icon notification-button" type="button" aria-label="Notificações" aria-haspopup="menu" aria-expanded="false" data-notifications-button>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M12 22a2.7 2.7 0 0 0 2.5-1.7h-5A2.7 2.7 0 0 0 12 22Zm7-5.8V11a7 7 0 0 0-5.5-6.8V3a1.5 1.5 0 0 0-3 0v1.2A7 7 0 0 0 5 11v5.2l-1.6 1.6V19h17.2v-1.2L19 16.2Z"/>
        </svg>
        <span class="notification-badge" data-notifications-badge hidden>0</span>
      </button>
      <div class="notifications-dropdown" role="menu" data-notifications-dropdown>
        <div class="notifications-head">
          <strong>Notificações</strong>
          <button type="button" data-notifications-read-all>Marcar como lidas</button>
        </div>
        <div class="notifications-list" data-notifications-list>
          <p class="notifications-empty">Carregando...</p>
        </div>
      </div>
    `;
    topActions.insertBefore(root, authLink);
    return root;
  }

  function formatNotificationTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function renderNotifications() {
    const root = ensureNotificationMenu();
    const badge = root.querySelector("[data-notifications-badge]");
    const list = root.querySelector("[data-notifications-list]");
    const readAll = root.querySelector("[data-notifications-read-all]");

    if (state.unreadCount > 0) {
      badge.hidden = false;
      badge.textContent = state.unreadCount > 99 ? "99+" : String(state.unreadCount);
    } else {
      badge.hidden = true;
      badge.textContent = "0";
    }

    readAll.disabled = state.unreadCount === 0;

    if (!state.notifications.length) {
      list.innerHTML = `<p class="notifications-empty">Nada novo por aqui.</p>`;
      return;
    }

    list.innerHTML = state.notifications.map((notification) => {
      const itemTag = notification.actionUrl ? "a" : "article";
      const href = notification.actionUrl ? ` href="${escapeHtml(notification.actionUrl)}"` : "";
      return `
        <${itemTag} class="notification-item ${notification.readAt ? "" : "is-unread"}"${href} role="menuitem">
          <span class="notification-avatar">
            ${notification.senderAvatarUrl ? `<img src="${escapeHtml(notification.senderAvatarUrl)}" alt="">` : "G"}
          </span>
          <span class="notification-copy">
            <strong>${escapeHtml(notification.title)}</strong>
            ${notification.body ? `<span>${escapeHtml(notification.body)}</span>` : ""}
            <small>${escapeHtml(notification.senderName || "Gimerr")} • ${escapeHtml(formatNotificationTime(notification.createdAt))}</small>
          </span>
        </${itemTag}>
      `;
    }).join("");
  }

  async function loadNotifications() {
    if (!state.session?.access_token || state.notificationsLoading) return;

    const root = ensureNotificationMenu();
    state.notificationsLoading = true;
    try {
      const response = await fetch("/api/notifications?limit=20", {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${state.session.access_token}`,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar notificações.");

      state.notifications = payload.notifications || [];
      state.unreadCount = Number(payload.unreadCount || 0);
      state.notificationsLoaded = true;
      renderNotifications();
    } catch (error) {
      root.querySelector("[data-notifications-list]").innerHTML = `<p class="notifications-empty">${escapeHtml(error.message || "Falha ao carregar notificações.")}</p>`;
    } finally {
      state.notificationsLoading = false;
    }
  }

  async function markNotificationsRead(id = "") {
    if (!state.session?.access_token) return;

    const response = await fetch("/api/notifications-read", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id }),
    });

    if (!response.ok) return;
  }

  function setNotificationsOpen(isOpen) {
    const root = ensureNotificationMenu();
    state.notificationsOpen = isOpen;
    root.classList.toggle("is-open", isOpen);
    root.querySelector("[data-notifications-button]")?.setAttribute("aria-expanded", String(isOpen));
    if (isOpen && state.unreadCount > 0) {
      state.unreadCount = 0;
      state.notifications = state.notifications.map((notification) => (
        notification.readAt ? notification : { ...notification, readAt: new Date().toISOString() }
      ));
      renderNotifications();
      markNotificationsRead();
    }
  }

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
    ensureNotificationMenu().hidden = false;
    accountMenu.innerHTML = `
      <button class="account-avatar-button" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Abrir menu da conta">
        <img src="${escapeHtml(avatarUrl || "./assets/avatar.svg")}" alt="${escapeHtml(displayName)}">
      </button>
      <div class="account-dropdown" role="menu">
        <a href="${profileUrl}" role="menuitem">Ver meu perfil</a>
        <a href="./edit-profile.html" role="menuitem">Edição de perfil</a>
        ${Number(state.profile?.is_admin || 0) === 1 ? `<a href="./admin.html" role="menuitem">Admin</a>` : ""}
        <button type="button" role="menuitem" disabled>Configurações <span>em breve</span></button>
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
    try {
      const client = await window.GimerrAuth.getClient();
      const { data } = await window.GimerrAuth.getSession();
      state.session = data.session;

      if (!state.session?.user) {
        authLink.hidden = false;
        accountMenu.hidden = true;
        ensureNotificationMenu().hidden = true;
        return;
      }

      state.profile = await loadProfile(client, state.session.user.id);
      renderMenu();
      window.setTimeout(() => {
        loadNotifications();
      }, 1200);
    } catch (error) {
      console.warn("Não foi possível carregar o menu da conta.", error);
      authLink.hidden = false;
      accountMenu.hidden = true;
      ensureNotificationMenu().hidden = true;
    }
  }

  document.addEventListener("click", (event) => {
    const notificationRoot = document.querySelector("[data-notifications-menu]");
    if (state.open && !accountMenu.contains(event.target)) setMenuOpen(false);
    if (state.notificationsOpen && notificationRoot && !notificationRoot.contains(event.target)) setNotificationsOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setMenuOpen(false);
      setNotificationsOpen(false);
    }
  });

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const isUserAvatar = image.closest(
      ".account-avatar-button, .post-avatar, .profile-avatar-large, .user-search-avatar, .notification-avatar, .media-lightbox-avatar",
    );
    if (!isUserAvatar || image.dataset.avatarFallbackApplied === "true") return;
    image.dataset.avatarFallbackApplied = "true";
    image.src = "./assets/avatar.svg";
  }, true);

  topActions.addEventListener("click", (event) => {
    const notificationButton = event.target.closest("[data-notifications-button]");
    if (notificationButton) {
      event.stopPropagation();
      const nextOpen = !state.notificationsOpen;
      setNotificationsOpen(nextOpen);
      if (nextOpen && !state.notificationsLoaded) {
        loadNotifications();
      }
      return;
    }

    const readAll = event.target.closest("[data-notifications-read-all]");
    if (readAll) {
      markNotificationsRead();
    }
  });

  init();
})();
