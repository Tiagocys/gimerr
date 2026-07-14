(function initGimerrShareModal() {
  const state = {
    modal: null,
    profiles: null,
    loadingProfiles: false,
    post: null,
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getPostUrl(postId, fallbackUrl = "") {
    if (fallbackUrl) return fallbackUrl;
    const url = new URL("/post", window.location.origin);
    url.searchParams.set("id", postId);
    return url.toString();
  }

  async function getSession() {
    if (!window.GimerrAuth) return null;
    const { data } = await window.GimerrAuth.getSession();
    return data?.session || null;
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

  function normalizeProfile(profile) {
    if (!profile?.id) return null;
    return {
      id: profile.id,
      displayName: profile.display_name || profile.username || "Usuário Gimerr",
      username: profile.username || "",
      avatarUrl: profile.avatar_url || "./assets/avatar.svg",
    };
  }

  async function loadSuggestedProfiles() {
    if (state.profiles) return state.profiles;
    const session = await getSession();
    if (!session?.user) {
      state.profiles = [];
      return state.profiles;
    }

    state.loadingProfiles = true;
    try {
      const client = await window.GimerrAuth.getClient();
      const { data: follows, error: followsError } = await client
        .from("user_follows")
        .select("following_id")
        .eq("follower_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(30);

      if (followsError) throw followsError;

      const followedIds = [...new Set((follows || [])
        .map((row) => row.following_id)
        .filter((id) => id && id !== session.user.id))];

      if (!followedIds.length) {
        state.profiles = [];
        return state.profiles;
      }

      const { data: profiles, error: profilesError } = await client
        .from("public_profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", followedIds);

      if (profilesError) throw profilesError;

      const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
      state.profiles = followedIds
        .map((id) => normalizeProfile(byId.get(id)))
        .filter(Boolean);
      return state.profiles;
    } finally {
      state.loadingProfiles = false;
    }
  }

  function ensureModal() {
    if (state.modal) return state.modal;

    const modal = document.createElement("div");
    modal.className = "modal-backdrop share-modal-backdrop";
    modal.hidden = true;
    modal.innerHTML = `
      <section class="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
        <div class="modal-head">
          <div>
            <h2 id="share-modal-title">Compartilhar post</h2>
            <p>Envie para alguém que você segue ou copie o link.</p>
          </div>
          <button class="ghost-icon share-modal-close" type="button" data-share-close aria-label="Fechar">×</button>
        </div>
        <button class="share-copy-button" type="button" data-share-copy>
          <span>Copiar link</span>
        </button>
        <div class="share-suggestions-head">
          <strong>Sugestões</strong>
          <small>Usuários que você segue</small>
        </div>
        <div class="share-suggestion-list" data-share-suggestions>
          <p class="share-empty">Carregando sugestões...</p>
        </div>
        <p class="field-feedback share-feedback" data-share-feedback role="status"></p>
      </section>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", handleModalClick);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) closeShareModal();
    });
    state.modal = modal;
    return modal;
  }

  function getModalEls() {
    const modal = ensureModal();
    return {
      modal,
      list: modal.querySelector("[data-share-suggestions]"),
      feedback: modal.querySelector("[data-share-feedback]"),
    };
  }

  function setFeedback(message, className = "") {
    const { feedback } = getModalEls();
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `field-feedback share-feedback ${className}`.trim();
  }

  function renderSuggestions(profiles, { loading = false } = {}) {
    const { list } = getModalEls();
    if (!list) return;
    if (loading) {
      list.innerHTML = `<p class="share-empty">Carregando sugestões...</p>`;
      return;
    }
    if (!profiles.length) {
      list.innerHTML = `<p class="share-empty">Você ainda não segue usuários para compartilhar por mensagem.</p>`;
      return;
    }

    list.innerHTML = profiles.map((profile) => `
      <button class="share-suggestion-item" type="button" data-share-recipient="${escapeHtml(profile.id)}">
        <span class="conversation-avatar">
          <img src="${escapeHtml(profile.avatarUrl || "./assets/avatar.svg")}" alt="">
        </span>
        <span class="share-suggestion-copy">
          <strong>${escapeHtml(profile.displayName)}</strong>
          ${profile.username ? `<span>@${escapeHtml(profile.username)}</span>` : ""}
        </span>
        <small>Enviar</small>
      </button>
    `).join("");
  }

  function closeShareModal() {
    if (!state.modal) return;
    state.modal.hidden = true;
    state.post = null;
  }

  async function sendPostToProfile(profileId, button) {
    const session = await getSession();
    if (!session?.access_token) {
      window.location.assign("./sign-in.html");
      return;
    }
    const post = state.post;
    if (!post?.url) return;

    const originalText = button?.textContent || "";
    if (button) {
      button.disabled = true;
      button.querySelector("small").textContent = "Enviando...";
    }
    setFeedback("");

    try {
      const startResponse = await fetch("/api/messages/start", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ recipientId: profileId }),
      });
      const startPayload = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok || !startPayload.conversationId) {
        throw new Error(startPayload.error || "Não foi possível abrir a conversa.");
      }

      const body = post.url;
      const sendResponse = await fetch("/api/messages/send", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          conversationId: startPayload.conversationId,
          body,
        }),
      });
      const sendPayload = await sendResponse.json().catch(() => ({}));
      if (!sendResponse.ok) {
        throw new Error(sendPayload.error || "Não foi possível enviar o link.");
      }

      setFeedback("Link enviado por mensagem.", "is-success");
      window.dispatchEvent(new CustomEvent("gimerr:message-sent"));
    } catch (error) {
      setFeedback(error.message || "Não foi possível enviar o link.", "is-error");
      if (button) button.disabled = false;
      if (button?.querySelector("small")) button.querySelector("small").textContent = "Enviar";
      return;
    }

    if (button?.querySelector("small")) button.querySelector("small").textContent = "Enviado";
    setTimeout(closeShareModal, 850);
  }

  async function handleModalClick(event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target) return;

    if (target.closest("[data-share-close]") || target === state.modal) {
      closeShareModal();
      return;
    }

    const copyButton = target.closest("[data-share-copy]");
    if (copyButton) {
      await copyTextToClipboard(state.post?.url || window.location.href);
      setFeedback("Link copiado.", "is-success");
      return;
    }

    const recipientButton = target.closest("[data-share-recipient]");
    if (recipientButton) {
      await sendPostToProfile(recipientButton.dataset.shareRecipient, recipientButton);
    }
  }

  async function openPostShare(options = {}) {
    const postId = options.postId || options.id || "";
    const gameName = options.gameName || options.post?.game?.name || options.post?.gameName || "Gimerr";
    const isVideo = options.post?.type === "video" || options.type === "video";
    state.post = {
      id: postId,
      url: getPostUrl(postId, options.url),
      title: options.title || (isVideo ? "Veja este vídeo no Gimerr" : "Veja este post no Gimerr"),
      text: options.text || `Publicado em ${gameName}`,
    };

    const modal = ensureModal();
    modal.hidden = false;
    setFeedback("");
    renderSuggestions([], { loading: true });

    try {
      const profiles = await loadSuggestedProfiles();
      renderSuggestions(profiles);
    } catch (error) {
      console.warn("Não foi possível carregar sugestões de compartilhamento.", error);
      renderSuggestions([]);
      setFeedback("Não foi possível carregar sugestões agora.", "is-warning");
    }
  }

  window.GimerrShare = {
    openPostShare,
    closeShareModal,
  };
})();
