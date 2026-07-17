(function initGimerrReportModal() {
  const DISCORD_INVITE_FALLBACK = "https://discord.gg/tCPVFu6juS";
  let reportBackdrop = null;
  let verificationBackdrop = null;
  let activePostId = "";
  let activeProfileId = "";
  let activeReportType = "post";
  let activeToken = "";
  let isSubmitting = false;
  let selectedAttachments = [];

  const MAX_ATTACHMENTS = 5;
  const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
  const ATTACHMENT_MAX_SIDE = 1600;
  const ATTACHMENT_WEBP_QUALITY = 0.82;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function ensureReportModal() {
    if (reportBackdrop) return reportBackdrop;
    reportBackdrop = document.createElement("div");
    reportBackdrop.className = "modal-backdrop";
    reportBackdrop.id = "report-reason-modal";
    reportBackdrop.hidden = true;
    reportBackdrop.innerHTML = `
      <section class="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-modal-title">
        <header class="modal-head">
          <div>
            <h2 id="report-modal-title">Denunciar anúncio</h2>
            <p>Explique o que está acontecendo para a equipe do Gimerr analisar o caso com contexto.</p>
          </div>
        </header>
        <label class="report-reason-field">
          <span>Motivo da denúncia</span>
          <textarea id="report-reason-input" rows="5" maxlength="500" placeholder="Descreva o motivo da denúncia."></textarea>
        </label>
        <div class="report-attachment-field">
          <div>
            <span>Anexos</span>
            <small>Opcional. Envie até 5 imagens para complementar a denúncia.</small>
          </div>
          <label class="text-button report-attachment-button">
            <input id="report-attachment-input" type="file" accept="image/jpeg,image/png,image/webp" multiple>
            <span>Adicionar imagens</span>
          </label>
          <div class="report-attachment-preview" id="report-attachment-preview" hidden></div>
        </div>
        <p class="field-feedback" id="report-modal-feedback" role="status"></p>
        <div class="modal-actions">
          <button class="text-button" type="button" data-report-cancel>Cancelar</button>
          <button class="primary-button" type="button" data-report-submit>Enviar denúncia</button>
        </div>
      </section>
    `;
    document.body.appendChild(reportBackdrop);

    reportBackdrop.addEventListener("click", (event) => {
      if (event.target === reportBackdrop || event.target.closest("[data-report-cancel]")) {
        closeReportModal();
      }
      if (event.target.closest("[data-report-submit]")) {
        submitReport();
      }
      const removeButton = event.target.closest("[data-report-remove-attachment]");
      if (removeButton) {
        removeAttachment(Number(removeButton.dataset.reportRemoveAttachment));
      }
    });
    reportBackdrop.querySelector("#report-attachment-input").addEventListener("change", handleAttachmentInput);
    return reportBackdrop;
  }

  function ensureVerificationModal() {
    if (verificationBackdrop) return verificationBackdrop;
    verificationBackdrop = document.createElement("div");
    verificationBackdrop.className = "modal-backdrop";
    verificationBackdrop.id = "report-verification-modal";
    verificationBackdrop.hidden = true;
    verificationBackdrop.innerHTML = `
      <section class="verification-modal" role="dialog" aria-modal="true" aria-labelledby="report-verification-title">
        <header class="modal-head">
          <div>
            <h2 id="report-verification-title">Verifique sua conta para denunciar</h2>
            <p>Para proteger o sistema de reputação do Gimerr, denúncias só podem ser enviadas por contas verificadas pelo bot no Discord.</p>
          </div>
        </header>
        <div class="verification-steps" id="report-verification-steps"></div>
        <p class="field-feedback" id="report-verification-feedback" role="status"></p>
        <div class="modal-actions">
          <button class="text-button" type="button" data-report-verification-close>Agora não</button>
        </div>
      </section>
    `;
    document.body.appendChild(verificationBackdrop);

    verificationBackdrop.addEventListener("click", (event) => {
      if (event.target === verificationBackdrop || event.target.closest("[data-report-verification-close]")) {
        verificationBackdrop.hidden = true;
      }
      const inviteButton = event.target.closest("[data-report-verification-invite]");
      if (inviteButton) {
        const invite = inviteButton.dataset.invite || "";
        const feedback = verificationBackdrop.querySelector("#report-verification-feedback");
        if (!invite) {
          feedback.textContent = "Convite do servidor oficial ainda não configurado.";
          feedback.className = "field-feedback is-error";
          return;
        }
        window.open(invite, "_blank", "noopener");
      }
    });
    return verificationBackdrop;
  }

  function setReportFeedback(message, tone = "") {
    const feedback = ensureReportModal().querySelector("#report-modal-feedback");
    feedback.textContent = message || "";
    feedback.className = `field-feedback${tone ? ` is-${tone}` : ""}`;
  }

  function setSubmitState(isLoading) {
    const button = ensureReportModal().querySelector("[data-report-submit]");
    button.disabled = isLoading;
    button.textContent = isLoading ? "Enviando..." : "Enviar denúncia";
  }

  function closeReportModal(options = {}) {
    if (!reportBackdrop || isSubmitting) return;
    reportBackdrop.hidden = true;
    if (!options.preserveContext) {
      activePostId = "";
      activeProfileId = "";
      activeReportType = "post";
      activeToken = "";
      clearAttachments();
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function compressAttachmentImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      throw new Error("Envie imagens JPG, PNG ou WebP.");
    }
    const image = await loadImage(file);
    const scale = Math.min(1, ATTACHMENT_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    let blob = await canvasToBlob(canvas, "image/webp", ATTACHMENT_WEBP_QUALITY);
    if (blob?.size > MAX_ATTACHMENT_BYTES) {
      blob = await canvasToBlob(canvas, "image/webp", 0.68);
    }
    if (!blob || blob.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("A imagem deve ter no máximo 3 MB após a compressão.");
    }
    const baseName = file.name.replace(/\.[^.]+$/, "") || "denuncia";
    return new File([blob], `${baseName}.webp`, { type: "image/webp" });
  }

  function revokeAttachmentUrls() {
    selectedAttachments.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  }

  function clearAttachments() {
    revokeAttachmentUrls();
    selectedAttachments = [];
    const modal = ensureReportModal();
    const input = modal.querySelector("#report-attachment-input");
    const preview = modal.querySelector("#report-attachment-preview");
    if (input) input.value = "";
    if (preview) {
      preview.hidden = true;
      preview.innerHTML = "";
    }
  }

  function renderAttachments() {
    const preview = ensureReportModal().querySelector("#report-attachment-preview");
    if (!selectedAttachments.length) {
      preview.hidden = true;
      preview.innerHTML = "";
      return;
    }
    preview.hidden = false;
    preview.innerHTML = selectedAttachments.map((item, index) => `
      <span class="report-attachment-thumb">
        <img src="${escapeHtml(item.previewUrl)}" alt="">
        <button class="ghost-icon" type="button" data-report-remove-attachment="${index}" aria-label="Remover imagem">×</button>
      </span>
    `).join("");
  }

  function removeAttachment(index) {
    const [removed] = selectedAttachments.splice(index, 1);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
    renderAttachments();
  }

  async function handleAttachmentInput(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    const remaining = MAX_ATTACHMENTS - selectedAttachments.length;
    if (remaining <= 0) {
      setReportFeedback("Você já adicionou o limite de 5 imagens.", "error");
      return;
    }
    const nextFiles = files.slice(0, remaining);
    if (files.length > remaining) {
      setReportFeedback(`Você pode anexar mais ${remaining} imagem(ns).`, "warning");
    } else {
      setReportFeedback("Preparando imagens...");
    }
    try {
      const compressedFiles = [];
      for (const file of nextFiles) {
        compressedFiles.push(await compressAttachmentImage(file));
      }
      selectedAttachments.push(...compressedFiles.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      })));
      renderAttachments();
      setReportFeedback("");
    } catch (error) {
      setReportFeedback(error.message || "Não foi possível preparar as imagens.", "error");
    }
  }

  async function loadVerificationStatus() {
    const response = await fetch("/api/verification/status", {
      headers: {
        accept: "application/json",
        ...(activeToken ? { authorization: `Bearer ${activeToken}` } : {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar a verificação.");
    return payload;
  }

  function isDiscordBotVerified(status = {}) {
    return status.verificationStatus === "verified"
      && status.verificationMethod === "discord_server_highest";
  }

  function renderVerificationSteps(status = {}) {
    const modal = ensureVerificationModal();
    const channelName = status.verifyChannelName || "gimerr-verification";
    const inviteUrl = status.serverInviteUrl || DISCORD_INVITE_FALLBACK;
    const steps = modal.querySelector("#report-verification-steps");
    steps.innerHTML = `
      <div class="verification-step">
        <strong>1. Entre no servidor oficial do Gimerr</strong>
        <span>O servidor usa a verificação do próprio Discord para reduzir spam e contas falsas.</span>
        <button class="primary-button verification-step-button" type="button" data-report-verification-invite data-invite="${escapeHtml(inviteUrl)}">
          <img src="/assets/share.svg" width="18" height="18" alt="">
          <span>Abrir servidor do Discord</span>
        </button>
      </div>
      <div class="verification-step">
        <strong>2. Clique no botão do bot no canal #${escapeHtml(channelName)}</strong>
        <span>No canal #${escapeHtml(channelName)}, clique em <code>Verify with Gimerr</code>. O bot enviará um link seguro só para você.</span>
      </div>
      <div class="verification-step">
        <strong>3. Volte para o Gimerr</strong>
        <span>Após concluir a verificação pelo link seguro do bot, tente enviar a denúncia novamente.</span>
      </div>
    `;
  }

  function renderVerificationLoading() {
    const modal = ensureVerificationModal();
    const steps = modal.querySelector("#report-verification-steps");
    steps.innerHTML = `
      <div class="verification-step verification-step-skeleton">
        <strong></strong>
        <span></span>
        <button class="primary-button verification-step-button" type="button" disabled>
          <span>Carregando...</span>
        </button>
      </div>
      <div class="verification-step verification-step-skeleton">
        <strong></strong>
        <span></span>
      </div>
      <div class="verification-step verification-step-skeleton">
        <strong></strong>
        <span></span>
      </div>
    `;
  }

  async function openVerificationModal() {
    if (reportBackdrop) reportBackdrop.hidden = true;
    const modal = ensureVerificationModal();
    const feedback = modal.querySelector("#report-verification-feedback");
    renderVerificationLoading();
    feedback.textContent = "Carregando instruções...";
    feedback.className = "field-feedback";
    modal.hidden = false;

    try {
      const status = await loadVerificationStatus();
      renderVerificationSteps(status);
      feedback.textContent = "";
      feedback.className = "field-feedback";
    } catch (error) {
      renderVerificationSteps({});
      feedback.textContent = error.message || "Não foi possível carregar a verificação.";
      feedback.className = "field-feedback is-error";
    }
  }

  async function submitReport() {
    if (isSubmitting) return;
    const modal = ensureReportModal();
    const input = modal.querySelector("#report-reason-input");
    const reason = input.value.trim();
    if (reason.length < 3) {
      setReportFeedback("Informe o motivo da denúncia.", "error");
      input.focus();
      return;
    }

    isSubmitting = true;
    setSubmitState(true);
    setReportFeedback("Enviando denúncia...");
    try {
      const isProfileReport = activeReportType === "profile";
      const body = new FormData();
      body.append("reason", reason);
      if (isProfileReport) {
        body.append("profileId", activeProfileId);
      } else {
        body.append("postId", activePostId);
      }
      selectedAttachments.forEach((item) => {
        body.append("attachments", item.file);
      });
      const response = await fetch(isProfileReport ? "/api/profiles/report" : "/api/posts/report", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${activeToken}`,
        },
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || (isProfileReport ? "Não foi possível denunciar este perfil." : "Não foi possível denunciar este post."));
        error.code = payload.code || "";
        throw error;
      }
      setReportFeedback("Denúncia enviada.", "success");
      window.setTimeout(() => closeReportModal(), 700);
    } catch (error) {
      if (error.code === "report_requires_discord_verification") {
        await openVerificationModal();
      } else {
        setReportFeedback(error.message || "Não foi possível enviar a denúncia.", "error");
      }
    } finally {
      isSubmitting = false;
      setSubmitState(false);
    }
  }

  function showReportModal() {
    const modal = ensureReportModal();
    const isProfileReport = activeReportType === "profile";
    modal.querySelector("#report-modal-title").textContent = isProfileReport ? "Denunciar perfil" : "Denunciar anúncio";
    modal.querySelector(".modal-head p").textContent = isProfileReport
      ? "Explique o que está acontecendo neste perfil para a equipe do Gimerr analisar o caso com contexto."
      : "Explique o que está acontecendo para a equipe do Gimerr analisar o caso com contexto.";
    modal.querySelector("#report-reason-input").value = "";
    clearAttachments();
    setReportFeedback("");
    setSubmitState(false);
    modal.hidden = false;
    window.setTimeout(() => modal.querySelector("#report-reason-input")?.focus(), 0);
  }

  async function openReportModal({ postId, profileId, token, type }) {
    if (!token) {
      window.location.assign("./sign-in.html");
      return;
    }
    activePostId = String(postId || "");
    activeProfileId = String(profileId || "");
    activeReportType = type === "profile" || activeProfileId ? "profile" : "post";
    activeToken = token;

    try {
      const status = await loadVerificationStatus();
      if (!isDiscordBotVerified(status)) {
        await openVerificationModal();
        return;
      }
    } catch (error) {
      console.warn("Não foi possível validar verificação antes da denúncia.", error);
    }

    showReportModal();
  }

  window.GimerrReport = {
    open: openReportModal,
    openVerification: openVerificationModal,
  };
})();
