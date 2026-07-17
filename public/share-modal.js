(function initGimerrShareModal() {
  const state = {
    modal: null,
    profiles: null,
    loadingProfiles: false,
    post: null,
    sharedRecipients: new Set(),
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

  function getListingDescription(post) {
    if (post?.type !== "listing") return "";
    const text = String(post?.body || "").trim();
    if (!text) return "";
    const marker = "\n\nItens:\n";
    const markerIndex = text.indexOf(marker);
    return (markerIndex >= 0 ? text.slice(0, markerIndex) : "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function createQrMarkup(url) {
    if (!window.qrcode || !url) return "";
    try {
      const qr = window.qrcode(0, "M");
      qr.addData(url);
      qr.make();
      return qr.createSvgTag(6, 2);
    } catch (error) {
      console.warn("Não foi possível gerar QR Code.", error);
      return "";
    }
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
      const { data: recommendations, error: recommendationsError } = await client
        .from("profile_recommendations")
        .select("recommended_id")
        .eq("recommender_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(30);

      if (recommendationsError) throw recommendationsError;

      const recommendedIds = [...new Set((recommendations || [])
        .map((row) => row.recommended_id)
        .filter((id) => id && id !== session.user.id))];

      if (!recommendedIds.length) {
        state.profiles = [];
        return state.profiles;
      }

      const { data: profiles, error: profilesError } = await client
        .from("public_profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", recommendedIds);

      if (profilesError) throw profilesError;

      const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
      state.profiles = recommendedIds
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
            <p>Envie para alguém que você recomenda ou copie o link.</p>
          </div>
          <button class="ghost-icon share-modal-close" type="button" data-share-close aria-label="Fechar">×</button>
        </div>
        <div class="share-qr-card" data-share-qr-card hidden>
          <p class="share-qr-description" data-share-qr-description hidden></p>
          <div class="share-qr-loader" data-share-qr-loader hidden>Gerando QR Code...</div>
          <div class="share-qr-frame" data-share-qr-frame hidden></div>
          <small>Escaneie para abrir este anúncio.</small>
        </div>
        <button class="share-copy-button" type="button" data-share-copy>
          <span>Copiar link</span>
        </button>
        <div class="share-suggestions-head">
          <strong>Sugestões</strong>
          <small>Usuários que você recomenda</small>
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
      title: modal.querySelector("#share-modal-title"),
      copy: modal.querySelector(".modal-head p"),
      copyButton: modal.querySelector("[data-share-copy]"),
      qrCard: modal.querySelector("[data-share-qr-card]"),
      qrDescription: modal.querySelector("[data-share-qr-description]"),
      qrFrame: modal.querySelector("[data-share-qr-frame]"),
      qrLoader: modal.querySelector("[data-share-qr-loader]"),
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
      list.innerHTML = `<p class="share-empty">Você ainda não recomendou usuários para compartilhar por mensagem.</p>`;
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
        <small>${state.sharedRecipients.has(profile.id) ? "Enviado" : "Enviar"}</small>
      </button>
    `).join("");
    list.querySelectorAll("[data-share-recipient]").forEach((button) => {
      if (state.sharedRecipients.has(button.dataset.shareRecipient)) {
        button.disabled = true;
        button.classList.add("is-sent");
      }
    });
  }

  function renderQrCard() {
    const { title, copy, qrCard, qrDescription, qrFrame, qrLoader } = getModalEls();
    const post = state.post || {};
    const isListing = post.type === "listing";
    if (title) title.textContent = isListing ? "Compartilhar anúncio" : "Compartilhar post";
    if (copy) {
      copy.textContent = isListing
        ? "Envie por mensagem, copie o link ou mostre o QR Code."
        : "Envie para alguém que você recomenda ou copie o link.";
    }
    if (!qrCard || !qrFrame) return;

    const qrMarkup = isListing ? createQrMarkup(post.url) : "";
    qrCard.hidden = !qrMarkup;
    qrLoader.hidden = !qrMarkup;
    qrFrame.hidden = true;
    qrFrame.innerHTML = qrMarkup
      ? `
        <div class="share-qr-code">
          ${qrMarkup}
          <img src="./assets/logo-square.svg" alt="Gimerr" data-share-qr-logo>
        </div>
      `
      : "";
    const logo = qrFrame.querySelector("[data-share-qr-logo]");
    if (logo) {
      const showQr = () => {
        qrLoader.hidden = true;
        qrFrame.hidden = false;
      };
      if (logo.complete) {
        showQr();
      } else {
        logo.addEventListener("load", showQr, { once: true });
        logo.addEventListener("error", showQr, { once: true });
      }
    }

    if (qrDescription) {
      qrDescription.textContent = post.description || "";
      qrDescription.hidden = !post.description;
    }
  }

  function closeShareModal() {
    if (!state.modal) return;
    state.modal.hidden = true;
    state.post = null;
    state.sharedRecipients = new Set();
  }

  async function sendPostToProfile(profileId, button) {
    const session = await getSession();
    if (!session?.access_token) {
      window.location.assign("./sign-in.html");
      return;
    }
    const post = state.post;
    if (!post?.url) return;

    if (state.sharedRecipients.has(profileId)) return;
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
    button?.classList.add("is-sent");
    state.sharedRecipients.add(profileId);
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
      copyButton.classList.add("is-copied");
      copyButton.querySelector("span").textContent = "Link copiado";
      window.setTimeout(() => {
        if (!state.modal || state.modal.hidden) return;
        copyButton.classList.remove("is-copied");
        copyButton.querySelector("span").textContent = "Copiar link";
      }, 1600);
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
    const isListing = options.post?.type === "listing" || options.type === "listing";
    state.post = {
      id: postId,
      url: getPostUrl(postId, options.url),
      type: options.post?.type || options.type || "",
      title: options.title || (isVideo ? "Veja este vídeo no Gimerr" : isListing ? "Veja este anúncio no Gimerr" : "Veja este post no Gimerr"),
      text: options.text || `Publicado em ${gameName}`,
      description: getListingDescription(options.post),
    };

    const modal = ensureModal();
    state.sharedRecipients = new Set();
    modal.hidden = false;
    setFeedback("");
    const { copyButton } = getModalEls();
    if (copyButton) {
      copyButton.classList.remove("is-copied");
      copyButton.querySelector("span").textContent = "Copiar link";
    }
    renderQrCard();
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
