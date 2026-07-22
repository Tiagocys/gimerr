(function initGimerrShareModal() {
  const state = {
    modal: null,
    post: null,
    session: null,
    suggestions: [],
    suggestionsLoading: false,
    sentRecipientIds: new Set(),
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

  function getAvatarUrl(profile) {
    const avatarUrl = String(profile?.avatar_url || profile?.avatarUrl || "");
    if (avatarUrl.includes("googleusercontent.com")) return "./assets/avatar.svg";
    return avatarUrl || "./assets/avatar.svg";
  }

  function getProfileName(profile) {
    return profile?.display_name || profile?.displayName || profile?.username || "Usuário Gimerr";
  }

  function getUsernameLabel(username) {
    const value = String(username || "").trim();
    if (!value) return "";
    return value.startsWith("@") ? value : `@${value}`;
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

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Não foi possível gerar a imagem do QR Code."));
      }, "image/png");
    });
  }

  async function copyQrCodeToClipboard() {
    const { qrFrame } = getModalEls();
    const svg = qrFrame?.querySelector(".share-qr-code svg");
    if (!svg) throw new Error("QR Code indisponível para copiar.");
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("Seu navegador não permite copiar imagens. Use a opção de copiar link.");
    }

    const size = 768;
    const padding = 48;
    const logoSize = Math.round(size * 0.2);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a imagem do QR Code.");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);

    const svgText = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
      const qrImage = await loadImage(svgUrl);
      context.drawImage(qrImage, padding, padding, size - padding * 2, size - padding * 2);

      const logoImage = await loadImage("./assets/logo-square-fundo-branco.svg");
      const logoX = (size - logoSize) / 2;
      const logoY = (size - logoSize) / 2;
      const logoPadding = Math.round(logoSize * 0.12);
      context.fillStyle = "#ffffff";
      context.fillRect(logoX - logoPadding, logoY - logoPadding, logoSize + logoPadding * 2, logoSize + logoPadding * 2);
      context.drawImage(logoImage, logoX, logoY, logoSize, logoSize);
    } finally {
      URL.revokeObjectURL(svgUrl);
    }

    const blob = await canvasToPngBlob(canvas);
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
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
          </div>
          <button class="ghost-icon share-modal-close" type="button" data-share-close aria-label="Fechar">×</button>
        </div>
        <div class="share-qr-card" data-share-qr-card hidden>
          <p class="share-qr-description" data-share-qr-description hidden></p>
          <div class="share-qr-loader" data-share-qr-loader hidden>Gerando QR Code...</div>
          <div class="share-qr-frame" data-share-qr-frame hidden></div>
          <button class="share-qr-copy-button" type="button" data-share-qr-copy aria-label="Copiar imagem do QR Code">
            <img src="./assets/copy.svg" alt="">
          </button>
        </div>
        <button class="share-copy-button" type="button" data-share-copy>
          <span>Copiar link</span>
        </button>
        <div class="share-suggestions" data-share-suggestions hidden>
          <div class="share-suggestions-head">
            <strong>Enviar por mensagem</strong>
            <span>Usuários que você recomenda</span>
          </div>
          <div class="share-suggestion-list" data-share-suggestion-list></div>
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
      feedback: modal.querySelector("[data-share-feedback]"),
      title: modal.querySelector("#share-modal-title"),
      copyButton: modal.querySelector("[data-share-copy]"),
      qrCard: modal.querySelector("[data-share-qr-card]"),
      qrDescription: modal.querySelector("[data-share-qr-description]"),
      qrFrame: modal.querySelector("[data-share-qr-frame]"),
      qrLoader: modal.querySelector("[data-share-qr-loader]"),
      suggestions: modal.querySelector("[data-share-suggestions]"),
      suggestionsList: modal.querySelector("[data-share-suggestion-list]"),
    };
  }

  function setFeedback(message, className = "") {
    const { feedback } = getModalEls();
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `field-feedback share-feedback ${className}`.trim();
  }

  function renderQrCard() {
    const { title, qrCard, qrDescription, qrFrame, qrLoader } = getModalEls();
    const post = state.post || {};
    const isListing = post.type === "listing";
    if (title) title.textContent = isListing ? "Compartilhar anúncio" : "Compartilhar post";
    if (!qrCard || !qrFrame) return;

    const qrMarkup = createQrMarkup(post.url);
    qrCard.hidden = !qrMarkup;
    qrLoader.hidden = !qrMarkup;
    qrFrame.hidden = true;
    qrFrame.innerHTML = qrMarkup
      ? `
        <div class="share-qr-code">
          ${qrMarkup}
          <img src="./assets/logo-square-fundo-branco.svg" alt="Gimerr" data-share-qr-logo>
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

  function renderSuggestions() {
    const { suggestions, suggestionsList } = getModalEls();
    if (!suggestions || !suggestionsList) return;

    if (!state.session?.access_token) {
      suggestions.hidden = true;
      suggestionsList.innerHTML = "";
      return;
    }

    suggestions.hidden = false;
    if (state.suggestionsLoading) {
      suggestionsList.innerHTML = `
        <div class="share-suggestion-loader">
          <span></span>
          <span></span>
          <span></span>
        </div>
      `;
      return;
    }

    if (!state.suggestions.length) {
      suggestions.hidden = true;
      suggestionsList.innerHTML = "";
      return;
    }

    suggestionsList.innerHTML = state.suggestions.map((profile) => {
      const id = String(profile.id || "");
      const sent = state.sentRecipientIds.has(id);
      const name = getProfileName(profile);
      const username = getUsernameLabel(profile.username);
      return `
        <article class="share-suggestion-item">
          <span class="share-suggestion-avatar">
            <img src="${escapeHtml(getAvatarUrl(profile))}" alt="" loading="lazy" data-share-avatar>
          </span>
          <span class="share-suggestion-copy">
            <strong>${escapeHtml(name)}</strong>
            ${username ? `<small>${escapeHtml(username)}</small>` : ""}
          </span>
          <button class="share-suggestion-send" type="button" data-share-send data-recipient-id="${escapeHtml(id)}" ${sent ? "disabled" : ""}>
            ${sent ? "Enviado" : "Enviar"}
          </button>
        </article>
      `;
    }).join("");
  }

  async function getCurrentSession() {
    if (!window.GimerrAuth) return null;
    const { data } = await window.GimerrAuth.getSession();
    state.session = data.session || null;
    return state.session;
  }

  async function loadShareSuggestions() {
    const session = await getCurrentSession().catch(() => null);
    if (!session?.access_token || !session.user?.id) {
      state.suggestions = [];
      state.suggestionsLoading = false;
      renderSuggestions();
      return;
    }

    state.suggestionsLoading = true;
    renderSuggestions();
    try {
      const client = await window.GimerrAuth.getClient();
      const { data: recommendations, error: recommendationsError } = await client
        .from("profile_recommendations")
        .select("recommended_id")
        .eq("recommender_id", session.user.id)
        .limit(20);
      if (recommendationsError) throw recommendationsError;

      const recommendedIds = [...new Set((recommendations || [])
        .map((row) => row.recommended_id)
        .filter(Boolean))];
      if (!recommendedIds.length) {
        state.suggestions = [];
        return;
      }

      const { data: profiles, error: profilesError } = await client
        .from("profiles")
        .select("id, display_name, username, avatar_url")
        .in("id", recommendedIds);
      if (profilesError) throw profilesError;

      const byId = new Map((profiles || []).map((profile) => [String(profile.id), profile]));
      state.suggestions = recommendedIds
        .map((id) => byId.get(String(id)))
        .filter(Boolean);
    } catch (error) {
      console.warn("Não foi possível carregar sugestões de compartilhamento.", error);
      state.suggestions = [];
    } finally {
      state.suggestionsLoading = false;
      renderSuggestions();
    }
  }

  function closeShareModal() {
    if (!state.modal) return;
    state.modal.hidden = true;
    state.post = null;
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

    const qrCopyButton = target.closest("[data-share-qr-copy]");
    if (qrCopyButton) {
      qrCopyButton.disabled = true;
      try {
        await copyQrCodeToClipboard();
        setFeedback("QR Code copiado.", "is-success");
      } catch (error) {
        setFeedback(error.message || "Não foi possível copiar o QR Code.", "is-warning");
      } finally {
        qrCopyButton.disabled = false;
      }
      return;
    }

    const sendButton = target.closest("[data-share-send]");
    if (sendButton) {
      await sendShareToProfile(sendButton);
    }
  }

  async function shareApi(path, options = {}) {
    const session = await getCurrentSession();
    if (!session?.access_token) throw new Error("Entre para enviar por mensagem.");

    const response = await fetch(path, {
      ...options,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível compartilhar por mensagem.");
    return payload;
  }

  async function sendShareToProfile(button) {
    const recipientId = button.dataset.recipientId || "";
    if (!recipientId || state.sentRecipientIds.has(recipientId)) return;
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = "Enviando...";
    setFeedback("");
    try {
      const start = await shareApi("/api/messages/start", {
        method: "POST",
        body: JSON.stringify({ recipientId }),
      });
      await shareApi("/api/messages/send", {
        method: "POST",
        body: JSON.stringify({
          conversationId: start.conversationId,
          body: state.post?.url || window.location.href,
        }),
      });
      state.sentRecipientIds.add(recipientId);
      button.textContent = "Enviado";
      button.disabled = true;
      setFeedback("Compartilhamento enviado por mensagem.", "is-success");
      window.dispatchEvent(new CustomEvent("gimerr:messages-read"));
    } catch (error) {
      button.disabled = false;
      button.textContent = previousText || "Enviar";
      setFeedback(error.message || "Não foi possível enviar.", "is-warning");
    }
  }

  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.matches("[data-share-avatar]")) return;
    if (image.dataset.avatarFallbackApplied === "true") return;
    image.dataset.avatarFallbackApplied = "true";
    image.src = "./assets/avatar.svg";
  }, true);

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
    state.sentRecipientIds = new Set();
    state.suggestions = [];
    state.suggestionsLoading = false;
    state.session = null;

    const modal = ensureModal();
    modal.hidden = false;
    setFeedback("");
    const { copyButton } = getModalEls();
    if (copyButton) {
      copyButton.classList.remove("is-copied");
      copyButton.querySelector("span").textContent = "Copiar link";
    }
    renderQrCard();
    renderSuggestions();
    loadShareSuggestions();
  }

  window.GimerrShare = {
    openPostShare,
    closeShareModal,
  };
})();
