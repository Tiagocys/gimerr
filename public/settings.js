(async function initSettingsPage() {
  const list = document.querySelector("#ignored-users-list");
  const state = {
    session: null,
    users: [],
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getProfileUrl(user) {
    if (user.username) return `./profile?u=${encodeURIComponent(user.username)}`;
    return `./profile?id=${encodeURIComponent(user.id)}`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar configurações.");
    return payload;
  }

  function renderIgnoredUsers() {
    if (!list) return;
    if (!state.users.length) {
      list.innerHTML = `<p class="settings-empty">Você ainda não ignorou nenhum usuário.</p>`;
      return;
    }

    list.innerHTML = state.users.map((user) => `
      <article class="ignored-user-item">
        <a class="ignored-user-profile" href="${escapeHtml(getProfileUrl(user))}">
          <img src="${escapeHtml(user.avatarUrl || "./assets/avatar.svg")}" alt="">
          <span>
            <strong>${escapeHtml(user.displayName || user.username || "Usuário Gimerr")}</strong>
            ${user.username ? `<small>@${escapeHtml(user.username)}</small>` : ""}
          </span>
        </a>
        <button class="text-button" type="button" data-unignore-user="${escapeHtml(user.id)}">Deixar de ignorar</button>
      </article>
    `).join("");
  }

  async function loadIgnoredUsers() {
    const payload = await api("/api/users/ignored");
    state.users = payload.users || [];
    renderIgnoredUsers();
  }

  async function unignoreUser(profileId) {
    await api(`/api/users/ignore?profileId=${encodeURIComponent(profileId)}`, {
      method: "DELETE",
    });
    state.users = state.users.filter((user) => user.id !== profileId);
    renderIgnoredUsers();
  }

  try {
    const { data } = await window.GimerrAuth.getSession();
    if (!data.session?.user) {
      window.location.replace("./sign-in.html");
      return;
    }
    state.session = data.session;
    await loadIgnoredUsers();
  } catch (error) {
    console.warn("Não foi possível carregar configurações.", error);
    if (list) list.innerHTML = `<p class="settings-empty">${escapeHtml(error.message || "Não foi possível carregar configurações.")}</p>`;
  }

  list?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-unignore-user]");
    if (!button) return;
    button.disabled = true;
    try {
      await unignoreUser(button.dataset.unignoreUser || "");
    } catch (error) {
      console.warn("Não foi possível deixar de ignorar usuário.", error);
      window.alert(error.message || "Não foi possível deixar de ignorar este usuário.");
      button.disabled = false;
    }
  });
})();
