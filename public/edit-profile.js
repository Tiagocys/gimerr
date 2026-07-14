const reservedUsernames = new Set(["admin", "gimerr", "suporte", "discord", "steam"]);
const USERNAME_CHANGE_INTERVAL_DAYS = 15;

const platforms = [
  { id: "steam", name: "Steam", handle: "", connected: false, isPublic: true },
  { id: "discord", name: "Discord", handle: "", connected: false, isPublic: true },
  { id: "blizzard", name: "Blizzard", handle: "", connected: false, isPublic: true },
  { id: "twitch", name: "Twitch", handle: "", connected: false, isPublic: true },
  { id: "xbox", name: "Xbox", handle: "", connected: false, isPublic: true },
  { id: "playstation", name: "PlayStation", handle: "", connected: false, isPublic: true },
];

const connectablePlatforms = new Set(["discord", "twitch"]);

const mediaTargets = {
  avatar: {
    outputWidth: 512,
    outputHeight: 512,
    quality: 0.84,
    filename: "profile-photo.jpg",
  },
};

const state = {
  session: null,
  profile: null,
  platformLinks: new Map(),
  avatarUrl: null,
  telegramPhoneChallenge: null,
  telegramPhoneUrl: null,
  telegramPhonePollTimer: null,
  media: {
    avatar: { file: null, objectUrl: null, x: 50, y: 50, zoom: 1 },
  },
};

const els = {
  layout: document.querySelector("#edit-profile-layout"),
  displayName: document.querySelector("#display-name"),
  username: document.querySelector("#username"),
  usernameFeedback: document.querySelector("#username-feedback"),
  phone: document.querySelector("#phone"),
  telegramPhoneVerify: document.querySelector("#telegram-phone-verify"),
  telegramPhoneFeedback: document.querySelector("#telegram-phone-feedback"),
  telegramPhoneModal: document.querySelector("#telegram-phone-modal"),
  telegramPhoneOpen: document.querySelector("#telegram-phone-open"),
  telegramPhoneCopy: document.querySelector("#telegram-phone-copy"),
  telegramPhoneCode: document.querySelector("#telegram-phone-code"),
  telegramPhoneModalClose: document.querySelector("#telegram-phone-modal-close"),
  telegramPhoneModalFeedback: document.querySelector("#telegram-phone-modal-feedback"),
  contactChannelField: document.querySelector("#contact-channel-field"),
  visibilityField: document.querySelector("#visibility-field"),
  contactPreviewCard: document.querySelector("#contact-preview-card"),
  contactPreviewAvatar: document.querySelector("#contact-preview-avatar"),
  contactPreviewName: document.querySelector("#contact-preview-name"),
  contactPreviewUsername: document.querySelector("#contact-preview-username"),
  contactPreviewList: document.querySelector("#contact-preview-list"),
  phoneWhatsapp: document.querySelector("#phone-whatsapp"),
  phoneTelegram: document.querySelector("#phone-telegram"),
  saveButton: document.querySelector("#save-profile"),
  saveFeedback: document.querySelector("#save-feedback"),
  platformList: document.querySelector("#platform-list"),
  avatarFile: document.querySelector("#avatar-file"),
  avatarPreview: document.querySelector("#avatar-preview img"),
  avatarX: document.querySelector("#avatar-x"),
  avatarY: document.querySelector("#avatar-y"),
  avatarZoom: document.querySelector("#avatar-zoom"),
  usernameChangeModal: document.querySelector("#username-change-modal"),
  usernameChangePreview: document.querySelector("#username-change-preview"),
  usernameChangeCancel: document.querySelector("#username-change-cancel"),
  usernameChangeConfirm: document.querySelector("#username-change-confirm"),
};

const cropControls = {
  avatar: {
    input: els.avatarFile,
    preview: els.avatarPreview,
    x: els.avatarX,
    y: els.avatarY,
    zoom: els.avatarZoom,
  },
};

function normalizeUsername(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, "")
    .slice(0, 24);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getUsernameUnlockDate(profile = state.profile) {
  if (!profile?.username_changed_at) return null;

  const changedAt = new Date(profile.username_changed_at);
  if (Number.isNaN(changedAt.getTime())) return null;

  changedAt.setDate(changedAt.getDate() + USERNAME_CHANGE_INTERVAL_DAYS);
  return changedAt;
}

function canChangeUsername(profile = state.profile) {
  const unlockDate = getUsernameUnlockDate(profile);
  return !unlockDate || unlockDate <= new Date();
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function validateUsername() {
  const username = normalizeUsername(els.username.value);
  if (els.username.value !== username) {
    els.username.value = username;
  }

  if (!canChangeUsername()) {
    const unlockDate = getUsernameUnlockDate();
    els.usernameFeedback.textContent = `Você poderá alterar seu username novamente em ${formatDateTime(unlockDate)}.`;
    els.usernameFeedback.className = "field-feedback is-warning";
    return username === state.profile?.username;
  }

  if (username.length < 3) {
    els.usernameFeedback.textContent = "Use pelo menos 3 caracteres.";
    els.usernameFeedback.className = "field-feedback is-warning";
    return false;
  }

  if (reservedUsernames.has(username)) {
    els.usernameFeedback.textContent = "Este username é reservado.";
    els.usernameFeedback.className = "field-feedback is-error";
    return false;
  }

  els.usernameFeedback.textContent = "Username pronto para salvar.";
  els.usernameFeedback.className = "field-feedback is-success";
  return true;
}

function showUsernameCooldownFeedback() {
  const unlockDate = getUsernameUnlockDate();
  if (!unlockDate || unlockDate <= new Date()) return false;

  els.usernameFeedback.textContent = `Username alterado recentemente. Nova alteração disponível em ${formatDateTime(unlockDate)}.`;
  els.usernameFeedback.className = "field-feedback is-warning";
  return true;
}

function updateUsernameChangeState() {
  const unlockDate = getUsernameUnlockDate();
  const isLocked = Boolean(unlockDate && unlockDate > new Date());

  els.username.disabled = false;
  els.username.readOnly = isLocked;
  if (isLocked) {
    els.usernameFeedback.textContent = "";
    els.usernameFeedback.className = "field-feedback";
    return;
  }

  validateUsername();
}

function getFriendlyProfileError(error) {
  const message = error?.message || "";
  if (message.includes("USERNAME_CHANGE_COOLDOWN")) {
    const [, rawDate] = message.split("USERNAME_CHANGE_COOLDOWN:");
    const unlockDate = rawDate ? new Date(rawDate.trim()) : getUsernameUnlockDate();
    const suffix = unlockDate && !Number.isNaN(unlockDate.getTime())
      ? ` Você poderá alterar novamente em ${formatDateTime(unlockDate)}.`
      : "";
    return `O username só pode ser alterado uma vez a cada ${USERNAME_CHANGE_INTERVAL_DAYS} dias.${suffix}`;
  }

  if (/duplicate key|profiles_username/i.test(message)) {
    return "Este username já está em uso.";
  }

  return error?.message || "Não foi possível salvar o perfil.";
}

function hasUsernameChanged() {
  const currentUsername = normalizeUsername(state.profile?.username || "");
  const nextUsername = normalizeUsername(els.username.value);
  return Boolean(currentUsername && nextUsername && currentUsername !== nextUsername);
}

function confirmUsernameChange() {
  const currentUsername = normalizeUsername(state.profile?.username || "");
  const nextUsername = normalizeUsername(els.username.value);

  if (!hasUsernameChanged()) return Promise.resolve(true);

  els.usernameChangePreview.innerHTML = `
    <span>@${currentUsername}</span>
    <strong>@${nextUsername}</strong>
  `;
  els.usernameChangeModal.hidden = false;
  els.usernameChangeConfirm.focus();

  return new Promise((resolve) => {
    function close(result) {
      els.usernameChangeModal.hidden = true;
      els.usernameChangeConfirm.removeEventListener("click", onConfirm);
      els.usernameChangeCancel.removeEventListener("click", onCancel);
      els.usernameChangeModal.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onKeyDown);
      resolve(result);
    }

    function onConfirm() {
      close(true);
    }

    function onCancel() {
      close(false);
    }

    function onBackdropClick(event) {
      if (event.target === els.usernameChangeModal) close(false);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") close(false);
    }

    els.usernameChangeConfirm.addEventListener("click", onConfirm);
    els.usernameChangeCancel.addEventListener("click", onCancel);
    els.usernameChangeModal.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKeyDown);
  });
}

function renderPlatforms() {
  els.platformList.innerHTML = platforms.map((platform) => `
    <article class="platform-row" data-platform-id="${platform.id}">
      <div class="platform-mark">${platform.name.slice(0, 2).toUpperCase()}</div>
      <div class="platform-copy">
        <strong>${platform.name}</strong>
        <span>${platform.connected ? platform.handle || "Conectado" : "Não conectado"}</span>
      </div>
      <label class="platform-visibility ${platform.connected ? "" : "is-disabled"}">
        <input type="checkbox" data-platform-visibility ${platform.isPublic ? "checked" : ""} ${platform.connected ? "" : "disabled"}>
        <span>Exibir no perfil</span>
      </label>
      <button class="text-button ${platform.connected ? "is-secondary-state" : ""}" type="button" data-platform-action ${!connectablePlatforms.has(platform.id) && !platform.connected ? "disabled" : ""}>
        ${platform.connected ? "Atualizar" : connectablePlatforms.has(platform.id) ? "Conectar" : "Em breve"}
      </button>
    </article>
  `).join("");
}

function getPlatformMeta(platform) {
  const id = String(platform || "").toLowerCase();
  if (id === "discord") return { id, label: "Discord", icon: "./assets/discord.svg" };
  if (id === "twitch") return { id, label: "Twitch", icon: "./assets/twitch.svg" };
  return { id, label: getPlatformName(id), icon: "" };
}

function renderContactPreviewPlatformItems() {
  return platforms
    .filter((platform) => platform.connected && platform.isPublic)
    .map((platform) => {
      const link = state.platformLinks.get(platform.id) || {};
      const platformMeta = getPlatformMeta(platform.id);
      const handleValue = platform.handle || link.handle || platformMeta.label;
      const handle = handleValue.startsWith("@") ? handleValue : `@${handleValue}`;
      const profileUrl = platform.id === "discord" && link.external_user_id
        ? `discord://-/users/${link.external_user_id}`
        : link.profile_url;
      const tag = profileUrl ? "a" : "span";
      const attrs = profileUrl
        ? `href="${escapeHtml(profileUrl)}" ${platform.id === "discord" ? "" : 'target="_blank" rel="noopener"'}`
        : "";

      return `
        <${tag} class="info-pill platform-pill platform-pill-${escapeHtml(platformMeta.id)}" ${attrs} aria-label="${escapeHtml(`${platformMeta.label}: ${handle}`)}" title="${escapeHtml(`${platformMeta.label}: ${handle}`)}">
          ${platformMeta.icon ? `<img src="${escapeHtml(platformMeta.icon)}" alt="" aria-hidden="true">` : `<strong>${escapeHtml(platformMeta.label.slice(0, 2).toUpperCase())}</strong>`}
          <span>${escapeHtml(handle)}</span>
        </${tag}>
      `;
    })
    .join("");
}

function syncPlatformState(links = []) {
  state.platformLinks = new Map(links.map((link) => [link.platform, link]));

  platforms.forEach((platform) => {
    const link = state.platformLinks.get(platform.id);
    platform.connected = Boolean(link);
    platform.handle = link?.handle || "";
    platform.isPublic = link ? link.is_public !== false : true;
  });

  renderPlatforms();
  renderContactPreview();
}

function updateCrop(target) {
  const controls = cropControls[target];
  const crop = state.media[target];
  if (!controls || !crop) return;

  crop.x = Number(controls.x.value);
  crop.y = Number(controls.y.value);
  crop.zoom = Number(controls.zoom.value) / 100;

  controls.preview.style.objectPosition = `${crop.x}% ${crop.y}%`;
  controls.preview.style.transform = `scale(${crop.zoom})`;
  controls.preview.style.transformOrigin = `${crop.x}% ${crop.y}%`;
}

function resetCropControls(target) {
  const controls = cropControls[target];
  if (!controls) return;

  controls.x.value = 50;
  controls.y.value = 50;
  controls.zoom.value = 100;
  state.media[target].x = 50;
  state.media[target].y = 50;
  state.media[target].zoom = 1;
  updateCrop(target);
}

function loadPreview(target) {
  const controls = cropControls[target];
  if (!controls) return;

  const [file] = controls.input.files;
  if (!file) return;

  const nextUrl = URL.createObjectURL(file);
  const previousUrl = state.media[target].objectUrl;
  controls.preview.src = nextUrl;
  controls.preview.dataset.objectUrl = nextUrl;
  state.media[target].file = file;
  state.media[target].objectUrl = nextUrl;
  resetCropControls(target);
  if (target === "avatar") renderContactPreview();

  if (previousUrl) {
    URL.revokeObjectURL(previousUrl);
  }
}

function setSaving(isSaving, label = "Salvando...") {
  els.saveButton.disabled = isSaving;
  els.saveButton.classList.toggle("is-loading", isSaving);
  els.saveButton.textContent = isSaving ? label : "Salvar alterações";
}

function setProfileLoading(isLoading) {
  els.layout?.classList.toggle("is-loading", isLoading);
  els.saveButton.disabled = isLoading;
}

function getPhoneVisibility() {
  return document.querySelector('input[name="phoneVisibility"]:checked')?.value || "private";
}

function setPhoneVisibility(isPublic) {
  const value = isPublic ? "public" : "private";
  const input = document.querySelector(`input[name="phoneVisibility"][value="${value}"]`);
  if (input) input.checked = true;
}

function hasVerifiedPhone(profile = state.profile) {
  return Boolean(profile?.phone_e164 && profile?.phone_verified_at);
}

function getPhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function renderContactPreview() {
  const verified = hasVerifiedPhone();
  const platformItems = renderContactPreviewPlatformItems();
  if (els.contactPreviewCard) els.contactPreviewCard.hidden = !verified && !platformItems;
  if (!verified && !platformItems) return;

  const phone = state.profile?.phone_e164 || "";
  const phoneDigits = getPhoneDigits(phone);
  const isPublic = getPhoneVisibility() === "public";
  const displayName = els.displayName.value.trim() || state.profile?.display_name || "Usuário Gimerr";
  const username = normalizeUsername(els.username.value) || state.profile?.username || "usuario";
  const showWhatsapp = isPublic && Boolean(els.phoneWhatsapp.checked) && phoneDigits;
  const showTelegram = isPublic && Boolean(els.phoneTelegram.checked) && phoneDigits;

  if (els.contactPreviewAvatar) {
    els.contactPreviewAvatar.src = state.avatarUrl || "./assets/avatar.svg";
  }
  if (els.contactPreviewName) {
    els.contactPreviewName.textContent = displayName;
  }
  if (els.contactPreviewUsername) {
    els.contactPreviewUsername.textContent = `@${username}`;
  }
  if (els.contactPreviewList) {
    const phoneItems = verified
      ? isPublic
        ? `
        <a class="info-pill" href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>
        ${showWhatsapp ? `<a class="info-pill contact-pill whatsapp-contact-pill" href="https://wa.me/${escapeHtml(phoneDigits)}" target="_blank" rel="noopener">
          <img src="./assets/whatsapp.svg" alt="">
          WhatsApp
        </a>` : ""}
        ${showTelegram ? `<a class="info-pill contact-pill telegram-contact-button" href="tg://resolve?phone=${escapeHtml(phoneDigits)}">
          <img src="./assets/telegram.svg" alt="">
          Telegram
        </a>` : ""}
      `
        : `<span class="contact-preview-empty">Telefone privado. Seus contatos não aparecerão no perfil.</span>`
      : "";
    els.contactPreviewList.innerHTML = [phoneItems, platformItems].filter(Boolean).join("");
  }
}

function isPhoneContactSchemaError(error) {
  return /phone_contact_(whatsapp|telegram)/i.test(error?.message || "");
}

function setTelegramPhoneFeedback(message, className = "") {
  if (!els.telegramPhoneFeedback) return;
  els.telegramPhoneFeedback.textContent = message;
  els.telegramPhoneFeedback.className = `field-feedback ${className}`.trim();
}

function setTelegramPhoneButton(isLoading, label) {
  if (!els.telegramPhoneVerify) return;
  const labelEl = els.telegramPhoneVerify.querySelector("span");
  els.telegramPhoneVerify.disabled = isLoading;
  const nextLabel = label || (isLoading ? "Aguardando Telegram..." : "Verificar com Telegram");
  if (labelEl) {
    labelEl.textContent = nextLabel;
  } else {
    els.telegramPhoneVerify.textContent = nextLabel;
  }
}

function setTelegramPhoneModalFeedback(message, className = "") {
  if (!els.telegramPhoneModalFeedback) return;
  els.telegramPhoneModalFeedback.textContent = message;
  els.telegramPhoneModalFeedback.className = `field-feedback ${className}`.trim();
}

function getTelegramPhoneCommand() {
  return state.telegramPhoneChallenge ? `/start verify_${state.telegramPhoneChallenge}` : "";
}

function renderTelegramPhoneModal() {
  const command = getTelegramPhoneCommand();
  if (els.telegramPhoneCode) {
    els.telegramPhoneCode.textContent = command || "Gerando código...";
  }
  if (els.telegramPhoneCopy) {
    els.telegramPhoneCopy.disabled = !command;
  }
  if (els.telegramPhoneOpen) {
    els.telegramPhoneOpen.disabled = !state.telegramPhoneUrl;
  }
}

function setTelegramPhoneModalLoading(isLoading) {
  els.telegramPhoneModal?.classList.toggle("is-loading", isLoading);
}

function openTelegramPhoneModal() {
  renderTelegramPhoneModal();
  setTelegramPhoneModalFeedback("", "");
  if (els.telegramPhoneModal) els.telegramPhoneModal.hidden = false;
  els.telegramPhoneOpen?.focus();
}

function closeTelegramPhoneModal() {
  if (els.telegramPhoneModal) els.telegramPhoneModal.hidden = true;
}

function stopTelegramPhonePolling() {
  if (state.telegramPhonePollTimer) {
    clearTimeout(state.telegramPhonePollTimer);
    state.telegramPhonePollTimer = null;
  }
}

function renderPhoneVerification() {
  const verified = hasVerifiedPhone();
  const isPublic = getPhoneVisibility() === "public";
  if (els.phone) {
    els.phone.readOnly = true;
    els.phone.value = verified ? state.profile.phone_e164 : "";
    els.phone.placeholder = verified ? "" : "Verifique pelo Telegram";
  }

  if (els.contactChannelField) els.contactChannelField.hidden = !verified || !isPublic;
  if (els.visibilityField) els.visibilityField.hidden = !verified;
  renderContactPreview();

  if (verified) {
    setTelegramPhoneButton(false, "Telefone verificado");
    els.telegramPhoneVerify.disabled = true;
    setTelegramPhoneFeedback("Telefone verificado pelo Telegram.", "is-success");
    return;
  }

  setTelegramPhoneButton(false, "Verificar com Telegram");
  setTelegramPhoneFeedback("Verifique seu telefone pelo Telegram se quiser exibir contato no perfil.", "");
}

async function pollTelegramPhoneVerification() {
  if (!state.telegramPhoneChallenge || hasVerifiedPhone()) return;

  try {
    const response = await fetch(`/api/telegram/phone-status?challenge=${encodeURIComponent(state.telegramPhoneChallenge)}`, {
      headers: {
        authorization: `Bearer ${state.session.access_token}`,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível consultar o Telegram.");

    if (payload.status === "completed" && payload.phone) {
      stopTelegramPhonePolling();
      closeTelegramPhoneModal();
      state.profile = {
        ...(state.profile || {}),
        phone_e164: payload.phone,
        phone_verified_at: payload.verifiedAt || new Date().toISOString(),
        phone_contact_telegram: true,
        phone_contact_whatsapp: false,
        phone_is_public: false,
      };
      els.phoneTelegram.checked = true;
      els.phoneWhatsapp.checked = false;
      setPhoneVisibility(false);
      renderPhoneVerification();
      return;
    }

    if (["expired", "failed"].includes(payload.status)) {
      stopTelegramPhonePolling();
      state.telegramPhoneChallenge = null;
      state.telegramPhoneUrl = null;
      renderTelegramPhoneModal();
      setTelegramPhoneButton(false, "Verificar com Telegram");
      setTelegramPhoneFeedback(
        payload.status === "expired"
          ? "A verificação expirou. Inicie o processo novamente."
          : "Não foi possível verificar o telefone. Tente novamente.",
        "is-error",
      );
      setTelegramPhoneModalFeedback(
        payload.status === "expired"
          ? "A verificação expirou. Inicie o processo novamente."
          : "Não foi possível verificar o telefone. Tente novamente.",
        "is-error",
      );
      return;
    }

    state.telegramPhonePollTimer = setTimeout(pollTelegramPhoneVerification, 3000);
  } catch (error) {
    stopTelegramPhonePolling();
    setTelegramPhoneButton(false, "Verificar com Telegram");
    setTelegramPhoneFeedback(error.message || "Não foi possível consultar o Telegram.", "is-error");
  }
}

async function startTelegramPhoneVerification() {
  const client = await getAuthenticatedClient();
  if (!client || hasVerifiedPhone()) return;

  if (state.telegramPhoneChallenge && state.telegramPhoneUrl) {
    openTelegramPhoneModal();
    return;
  }

  stopTelegramPhonePolling();
  state.telegramPhoneUrl = null;
  state.telegramPhoneChallenge = null;
  openTelegramPhoneModal();
  setTelegramPhoneModalLoading(true);
  setTelegramPhoneButton(true, "Preparando...");
  setTelegramPhoneFeedback("Gerando verificação segura no Telegram...", "");
  setTelegramPhoneModalFeedback("Gerando código seguro...", "");

  try {
    const response = await fetch("/api/telegram/phone-start", {
      method: "POST",
      headers: {
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.url || !payload.challenge) {
      throw new Error(payload.error || "Não foi possível abrir o Telegram.");
    }

    state.telegramPhoneChallenge = payload.challenge;
    state.telegramPhoneUrl = payload.url;
    renderTelegramPhoneModal();
    setTelegramPhoneModalLoading(false);
    setTelegramPhoneButton(false, "Ver instruções");
    setTelegramPhoneFeedback("No Telegram, toque em Compartilhar telefone. Esta tela será atualizada automaticamente.", "is-warning");
    setTelegramPhoneModalFeedback("", "");
    state.telegramPhonePollTimer = setTimeout(pollTelegramPhoneVerification, 3000);
  } catch (error) {
    state.telegramPhoneChallenge = null;
    state.telegramPhoneUrl = null;
    renderTelegramPhoneModal();
    setTelegramPhoneModalLoading(false);
    setTelegramPhoneButton(false, "Verificar com Telegram");
    setTelegramPhoneFeedback(error.message || "Não foi possível iniciar a verificação.", "is-error");
    setTelegramPhoneModalFeedback(error.message || "Não foi possível iniciar a verificação.", "is-error");
  }
}

function openTelegramPhoneLink() {
  if (!state.telegramPhoneUrl) return;
  window.open(state.telegramPhoneUrl, "_blank", "noopener");
}

async function copyTelegramPhoneCommand() {
  const command = getTelegramPhoneCommand();
  if (!command) return;

  try {
    await navigator.clipboard.writeText(command);
    setTelegramPhoneModalFeedback("Comando copiado. Cole no chat do bot do Gimerr no Telegram.", "is-success");
  } catch {
    setTelegramPhoneModalFeedback("Não foi possível copiar automaticamente. Selecione o comando e copie manualmente.", "is-error");
  }
}

function normalizePlatformHandle(value, fallback) {
  const cleanValue = String(value || fallback || "")
    .replace(/^@/, "")
    .trim();

  return cleanValue ? `@${cleanValue}` : "";
}

function getIdentityProvider(identity) {
  return String(identity?.provider || identity?.identity_data?.provider || "").toLowerCase();
}

function getIdentityExternalUserId(identity) {
  const data = identity?.identity_data || {};
  return data.provider_id || data.sub || data.id || identity?.id || identity?.identity_id || "";
}

function getDiscordIdentityPayload(identity) {
  const data = identity?.identity_data || {};
  const externalUserId = getIdentityExternalUserId(identity);
  if (!externalUserId) return null;

  const handle = normalizePlatformHandle(
    data.global_name || data.full_name || data.name || data.user_name || data.preferred_username,
    "discord"
  );

  return {
    profile_id: state.session.user.id,
    platform: "discord",
    handle,
    profile_url: `https://discord.com/users/${externalUserId}`,
    external_user_id: externalUserId,
    is_public: true,
  };
}

function getTwitchIdentityPayload(identity) {
  const data = identity?.identity_data || {};
  const externalUserId = getIdentityExternalUserId(identity);
  if (!externalUserId) return null;

  const handle = normalizePlatformHandle(
    data.user_name || data.preferred_username || data.full_name || data.name,
    "twitch"
  );
  const twitchLogin = handle.replace(/^@/, "").toLowerCase();

  return {
    profile_id: state.session.user.id,
    platform: "twitch",
    handle,
    profile_url: `https://www.twitch.tv/${encodeURIComponent(twitchLogin)}`,
    external_user_id: externalUserId,
    is_public: true,
  };
}

async function syncAuthProviderPlatformLinks(client) {
  const identities = state.session?.user?.identities || [];
  const payloads = identities
    .map((identity) => {
      const provider = getIdentityProvider(identity);
      if (provider === "discord") return getDiscordIdentityPayload(identity);
      if (provider === "twitch") return getTwitchIdentityPayload(identity);
      return null;
    })
    .filter(Boolean);

  if (!payloads.length) return;

  const providerIds = payloads.map((payload) => payload.platform);
  const { data: existingLinks, error: existingError } = await client
    .from("profile_platform_links")
    .select("platform, is_public")
    .eq("profile_id", state.session.user.id)
    .in("platform", providerIds);

  if (existingError) {
    console.warn("Não foi possível carregar visibilidade atual das plataformas.", existingError);
  }

  const existingVisibility = new Map((existingLinks || []).map((link) => [link.platform, link.is_public]));
  payloads.forEach((payload) => {
    if (existingVisibility.has(payload.platform)) {
      payload.is_public = existingVisibility.get(payload.platform) !== false;
    }
  });

  const { error } = await client
    .from("profile_platform_links")
    .upsert(payloads, { onConflict: "profile_id,platform" });

  if (error) {
    console.warn("Não foi possível sincronizar plataformas do login.", error);
  }
}

function getMediaKey(mediaUrl) {
  if (!mediaUrl) return "";

  let pathname = String(mediaUrl);
  try {
    pathname = new URL(mediaUrl, window.location.origin).pathname;
  } catch {
    pathname = pathname.split("?")[0];
  }

  const mediaPrefix = "/api/media/";
  const mediaIndex = pathname.indexOf(mediaPrefix);
  return decodeURIComponent(mediaIndex >= 0
    ? pathname.slice(mediaIndex + mediaPrefix.length)
    : pathname.replace(/^\/+/, ""));
}

async function getAuthenticatedClient() {
  const { data } = await window.GimerrAuth.getSession();
  if (!data.session?.user) {
    window.location.replace("./sign-in.html");
    return null;
  }

  state.session = data.session;
  return window.GimerrAuth.getClient();
}

async function loadProfile() {
  const client = await getAuthenticatedClient();
  if (!client) return;

  let { data, error } = await client
    .from("profiles")
    .select("id, display_name, username, username_changed_at, phone_e164, phone_is_public, phone_contact_whatsapp, phone_contact_telegram, phone_verified_at, phone_verification_method, avatar_url")
    .eq("id", state.session.user.id)
    .maybeSingle();

  if (isPhoneContactSchemaError(error)) {
    const fallbackResult = await client
      .from("profiles")
      .select("id, display_name, username, username_changed_at, phone_e164, phone_is_public, avatar_url")
      .eq("id", state.session.user.id)
      .maybeSingle();
    data = fallbackResult.data;
    error = fallbackResult.error;
  }

  if (error) throw error;

  await syncAuthProviderPlatformLinks(client);

  const { data: platformLinks, error: platformError } = await client
    .from("profile_platform_links")
    .select("platform, handle, profile_url, external_user_id, is_public, connected_at")
    .eq("profile_id", state.session.user.id);

  if (platformError) throw platformError;

  state.profile = data;
  const metadata = state.session.user.user_metadata || {};
  const fallbackName = metadata.full_name || metadata.name || state.session.user.email?.split("@")[0] || "";
  const fallbackUsername = state.session.user.email?.split("@")[0] || "";

  els.displayName.value = data?.display_name || fallbackName;
  els.username.value = data?.username || normalizeUsername(fallbackUsername);
  els.phoneWhatsapp.checked = Boolean(data?.phone_contact_whatsapp);
  els.phoneTelegram.checked = Boolean(data?.phone_contact_telegram);
  setPhoneVisibility(Boolean(data?.phone_is_public));
  renderPhoneVerification();

  state.avatarUrl = data?.avatar_url || null;

  els.avatarPreview.src = state.avatarUrl || "./assets/avatar.svg";
  renderContactPreview();

  updateUsernameChangeState();
  syncPlatformState(platformLinks || []);
}

async function refreshPlatformLinks() {
  const client = await getAuthenticatedClient();
  if (!client) return;

  const { data, error } = await client
    .from("profile_platform_links")
    .select("platform, handle, profile_url, external_user_id, is_public, connected_at")
    .eq("profile_id", state.session.user.id);

  if (error) throw error;
  syncPlatformState(data || []);
}

function getPlatformName(platformId) {
  return platforms.find((item) => item.id === platformId)?.name || platformId;
}

async function connectPlatform(platformId) {
  if (!connectablePlatforms.has(platformId)) return;

  const client = await getAuthenticatedClient();
  if (!client) return;

  const platform = platforms.find((item) => item.id === platformId);
  const platformName = getPlatformName(platformId);
  const previousHandle = platform?.handle || "";
  if (platform) {
    platform.connected = true;
    platform.handle = `Abrindo ${platformName}...`;
    renderPlatforms();
  }

  try {
    const response = await fetch(`/api/${platformId}/start`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        redirectPath: "/edit-profile",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.authorizeUrl) {
      throw new Error(payload.error || "Não foi possível abrir o Discord.");
    }

    window.location.assign(payload.authorizeUrl);
  } catch (error) {
    if (platform) {
      platform.connected = Boolean(state.platformLinks.get(platformId));
      platform.handle = previousHandle;
      renderPlatforms();
    }
    els.saveFeedback.className = "is-error";
    els.saveFeedback.textContent = error.message || `Não foi possível iniciar a conexão ${platformName}.`;
  }
}

async function completePlatformConnection(platformId, result) {
  const platformName = getPlatformName(platformId);
  const response = await fetch(`/api/${platformId}/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ result }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Não foi possível salvar a conexão ${platformName}.`);
  }

  await refreshPlatformLinks();
}

async function savePlatformVisibility(client) {
  const visibilityPayload = platforms
    .filter((platform) => platform.connected && state.platformLinks.has(platform.id))
    .map((platform) => {
      const link = state.platformLinks.get(platform.id);
      return {
        profile_id: state.session.user.id,
        platform: platform.id,
        handle: link.handle,
        profile_url: link.profile_url,
        external_user_id: link.external_user_id,
        is_public: Boolean(platform.isPublic),
      };
    });

  if (!visibilityPayload.length) return;

  const { error } = await client
    .from("profile_platform_links")
    .upsert(visibilityPayload, { onConflict: "profile_id,platform" });

  if (error) throw error;

  visibilityPayload.forEach((payload) => {
    const current = state.platformLinks.get(payload.platform) || {};
    state.platformLinks.set(payload.platform, { ...current, ...payload });
  });
}

async function saveSinglePlatformVisibility(platformId, isPublic) {
  const client = await getAuthenticatedClient();
  if (!client) return;

  const platform = platforms.find((item) => item.id === platformId);
  const link = state.platformLinks.get(platformId);
  if (!platform || !link) return;

  const { error } = await client
    .from("profile_platform_links")
    .update({ is_public: Boolean(isPublic) })
    .eq("profile_id", state.session.user.id)
    .eq("platform", platformId);

  if (error) throw error;

  state.platformLinks.set(platformId, { ...link, is_public: Boolean(isPublic) });
}

async function handlePlatformCallbackMessage(platformId) {
  const params = new URLSearchParams(window.location.search);
  const status = params.get(platformId);
  if (!status) return;

  const platformName = getPlatformName(platformId);
  if (status === "complete") {
    try {
      els.saveFeedback.className = "";
      els.saveFeedback.textContent = `Salvando conexão ${platformName}...`;
      await completePlatformConnection(platformId, params.get("result"));
      els.saveFeedback.className = "is-success";
      els.saveFeedback.textContent = `${platformName} conectado ao seu perfil.`;
    } catch (error) {
      els.saveFeedback.className = "is-error";
      els.saveFeedback.textContent = error.message || `Não foi possível conectar ${platformName}.`;
    }
  } else if (status === "cancelled") {
    els.saveFeedback.className = "is-warning";
    els.saveFeedback.textContent = `Conexão com ${platformName} cancelada.`;
  } else if (status === "error") {
    els.saveFeedback.className = "is-error";
    els.saveFeedback.textContent = params.get("message") || `Não foi possível conectar ${platformName}.`;
  }

  window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
}

async function uploadProfileImage(target, file) {
  const formData = new FormData();
  formData.append("target", target);
  formData.append("file", file);

  const response = await fetch("/api/profile-image-upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.session.access_token}`,
    },
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const stage = payload.stage ? ` (${payload.stage})` : "";
    throw new Error(`${payload.error || "Falha ao enviar imagem."}${stage}`);
  }

  return payload.url;
}

async function deleteProfileImage(target, url) {
  if (!url) return;

  const response = await fetch("/api/profile-image-delete", {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ target, url }),
  });

  if (!response.ok) {
    console.warn("Não foi possível remover imagem antiga.", await response.text().catch(() => ""));
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível preparar a imagem."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Não foi possível comprimir a imagem."));
    }, type, quality);
  });
}

async function prepareProfileImage(target) {
  const config = mediaTargets[target];
  const crop = state.media[target];
  if (!config || !crop?.file) return null;

  const image = await loadImage(crop.file);
  const canvas = document.createElement("canvas");
  canvas.width = config.outputWidth;
  canvas.height = config.outputHeight;

  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const xPosition = crop.x / 100;
  const yPosition = crop.y / 100;
  const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) * crop.zoom;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = (canvas.width - drawWidth) * xPosition;
  const drawY = (canvas.height - drawHeight) * yPosition;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  const blob = await canvasToBlob(canvas, "image/jpeg", config.quality);
  return new File([blob], config.filename, { type: blob.type, lastModified: Date.now() });
}

async function saveProfile() {
  if (!validateUsername()) {
    els.username.focus();
    return;
  }

  const shouldProceed = await confirmUsernameChange();
  if (!shouldProceed) {
    els.saveFeedback.className = "is-warning";
    els.saveFeedback.textContent = "Alteração de username cancelada.";
    return;
  }

  const client = await getAuthenticatedClient();
  if (!client) return;

  setSaving(true);
  els.saveFeedback.textContent = "";
  els.saveFeedback.className = "";

  try {
    const hasAvatarUpload = Boolean(state.media.avatar.file);
    const previousAvatarUrl = state.avatarUrl;

    if (hasAvatarUpload) {
      setSaving(true, "Comprimindo foto...");
      const avatarFile = await prepareProfileImage("avatar");
      setSaving(true, "Enviando foto...");
      state.avatarUrl = await uploadProfileImage("avatar", avatarFile);
      renderContactPreview();
    }

    setSaving(true, "Salvando perfil...");

    const phoneVerified = hasVerifiedPhone();
    const profilePayload = {
      id: state.session.user.id,
      display_name: els.displayName.value.trim() || "Usuário Gimerr",
      username: normalizeUsername(els.username.value),
      phone_is_public: phoneVerified ? getPhoneVisibility() === "public" : false,
      phone_contact_whatsapp: phoneVerified ? Boolean(els.phoneWhatsapp.checked) : false,
      phone_contact_telegram: phoneVerified ? Boolean(els.phoneTelegram.checked) : false,
      avatar_url: state.avatarUrl,
    };

    const { error } = await client
      .from("profiles")
      .upsert(profilePayload, { onConflict: "id" });

    if (error) {
      if (isPhoneContactSchemaError(error)) {
        throw new Error("As opções de WhatsApp e Telegram ainda precisam da migration do banco para serem salvas.");
      }
      throw new Error(getFriendlyProfileError(error));
    }

    await savePlatformVisibility(client);

    els.avatarFile.value = "";
    state.media.avatar.file = null;

    const cleanupTasks = [];
    if (hasAvatarUpload && previousAvatarUrl && getMediaKey(previousAvatarUrl) !== getMediaKey(state.avatarUrl)) {
      cleanupTasks.push(deleteProfileImage("avatar", previousAvatarUrl));
    }
    if (cleanupTasks.length) {
      await Promise.allSettled(cleanupTasks);
    }

    els.saveFeedback.className = "is-success";
    els.saveFeedback.textContent = hasAvatarUpload
      ? "Imagem enviada e perfil salvo com sucesso."
      : "Perfil salvo com sucesso.";
  } catch (error) {
    els.saveFeedback.className = "is-error";
    els.saveFeedback.textContent = getFriendlyProfileError(error);
  } finally {
    setSaving(false);
  }
}

els.username.addEventListener("input", validateUsername);
els.username.addEventListener("input", renderContactPreview);
els.displayName.addEventListener("input", renderContactPreview);
els.username.addEventListener("focus", showUsernameCooldownFeedback);
els.username.addEventListener("click", showUsernameCooldownFeedback);
els.username.addEventListener("keydown", (event) => {
  if (els.username.readOnly && showUsernameCooldownFeedback()) {
    event.preventDefault();
  }
});

els.platformList.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const row = event.target.closest("[data-platform-id]");
  if (!button || !row) return;

  connectPlatform(row.dataset.platformId);
});

els.platformList.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-platform-visibility]");
  const row = event.target.closest("[data-platform-id]");
  if (!input || !row) return;

  const platform = platforms.find((item) => item.id === row.dataset.platformId);
  if (!platform || !platform.connected) return;

  const previousValue = platform.isPublic;
  platform.isPublic = input.checked;
  renderContactPreview();

  input.disabled = true;
  try {
    await saveSinglePlatformVisibility(platform.id, input.checked);
  } catch (error) {
    platform.isPublic = previousValue;
    input.checked = previousValue;
    renderContactPreview();
    els.saveFeedback.className = "is-error";
    els.saveFeedback.textContent = "Não foi possível salvar a visibilidade da plataforma.";
  } finally {
    input.disabled = false;
  }
});

els.avatarFile.addEventListener("change", () => loadPreview("avatar"));
els.avatarPreview?.addEventListener("error", () => {
  if (els.avatarPreview.dataset.avatarFallbackApplied === "true") return;
  els.avatarPreview.dataset.avatarFallbackApplied = "true";
  els.avatarPreview.src = "./assets/avatar.svg";
});

["x", "y", "zoom"].forEach((control) => {
  cropControls.avatar[control].addEventListener("input", () => updateCrop("avatar"));
});

els.saveButton.addEventListener("click", saveProfile);
els.telegramPhoneVerify?.addEventListener("click", startTelegramPhoneVerification);
els.phoneWhatsapp?.addEventListener("change", renderContactPreview);
els.phoneTelegram?.addEventListener("change", renderContactPreview);
document.querySelectorAll('input[name="phoneVisibility"]').forEach((input) => {
  input.addEventListener("change", renderPhoneVerification);
});
els.telegramPhoneOpen?.addEventListener("click", openTelegramPhoneLink);
els.telegramPhoneCopy?.addEventListener("click", copyTelegramPhoneCommand);
els.telegramPhoneModalClose?.addEventListener("click", closeTelegramPhoneModal);
els.telegramPhoneModal?.addEventListener("click", (event) => {
  if (event.target === els.telegramPhoneModal) closeTelegramPhoneModal();
});

async function init() {
  renderPlatforms();
  setProfileLoading(true);

  try {
    await loadProfile();
    await handlePlatformCallbackMessage("discord");
    await handlePlatformCallbackMessage("twitch");
  } catch (error) {
    els.saveFeedback.textContent = error.message || "Não foi possível carregar o perfil.";
  } finally {
    setProfileLoading(false);
  }
}

init();
