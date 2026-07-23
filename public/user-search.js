(function initUserSearch() {
  const SEARCH_MIN_LENGTH = 2;
  const SEARCH_LIMIT = 8;
  const GAME_COVER_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
  const GAME_COVER_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
  const GAME_COVER_OUTPUT_SIZE = 640;
  const GAME_COVER_WEBP_QUALITY = 0.84;
  const GAME_REQUEST_LIMITS = {
    searchTags: 5,
    genres: 5,
    platforms: 8,
  };
  const TAXONOMY_I18N = {
    genres: {
      "Adventure": "Aventura",
      "Arcade": "Arcade",
      "Card & Board Game": "Cartas e tabuleiro",
      "Fighting": "Luta",
      "Hack and slash/Beat 'em up": "Hack and slash/Beat 'em up",
      "Indie": "Indie",
      "MOBA": "MOBA",
      "MMORPG": "MMORPG",
      "Music": "Música",
      "Pinball": "Pinball",
      "Platform": "Plataforma",
      "Point-and-click": "Apontar e clicar",
      "Puzzle": "Quebra-cabeça",
      "Quiz/Trivia": "Quiz/Trivia",
      "Racing": "Corrida",
      "Real Time Strategy (RTS)": "Estratégia em tempo real (RTS)",
      "Role-playing (RPG)": "RPG",
      "Shooter": "Tiro",
      "Simulator": "Simulação",
      "Sport": "Esporte",
      "Strategy": "Estratégia",
      "Tactical": "Tático",
      "Turn-based strategy (TBS)": "Estratégia por turnos (TBS)",
      "Visual Novel": "Visual novel",
    },
    platforms: {
      "PC (Microsoft Windows)": "PC",
      "Mac": "Mac",
      "Linux": "Linux",
      "PlayStation 2": "PlayStation 2",
      "PlayStation 3": "PlayStation 3",
      "PlayStation 4": "PlayStation 4",
      "PlayStation 5": "PlayStation 5",
      "Xbox": "Xbox",
      "Xbox 360": "Xbox 360",
      "Xbox One": "Xbox One",
      "Xbox Series X|S": "Xbox Series X|S",
      "Nintendo Switch": "Nintendo Switch",
      "Nintendo Switch 2": "Nintendo Switch 2",
      "Android": "Android",
      "iOS": "iOS",
      "Web browser": "Navegador",
    },
  };
  const EXTRA_TAXONOMY_SUGGESTIONS = {
    genres: [
      { id: "", name: "MMORPG", slug: "mmorpg", isLocal: true },
    ],
  };
  const inputs = Array.from(document.querySelectorAll(".search-box input[type='search']"));
  let currentUserIdPromise = null;

  if (!inputs.length || !window.GimerrAuth) return;

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

  function getPublicProfileUrl(profile) {
    if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
    return `./profile?id=${encodeURIComponent(profile.id)}`;
  }

  function getGameUrl(game) {
    if (game?.slug) return `/g/${encodeURIComponent(game.slug)}`;
    return `./game?id=${encodeURIComponent(game.igdbId)}`;
  }

  function getGameSubmitLabel(term) {
    return `Não encontramos o '${term}' na nossa base de jogos,`;
  }

  async function getCurrentUserId() {
    if (!currentUserIdPromise) {
      currentUserIdPromise = window.GimerrAuth.getSession()
        .then(({ data }) => data.session?.user?.id || "")
        .catch(() => "");
    }
    return currentUserIdPromise;
  }

  function sanitizeSearchTerm(value) {
    return String(value || "")
      .replace(/^@/, "")
      .replace(/[%,()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeSearchValue(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getTaxonomyDisplayName(groupName, item) {
    const name = item?.name || "";
    return TAXONOMY_I18N[groupName]?.[name] || name;
  }

  function getTaxonomyMeta(groupName, item) {
    if (item?.isLocal) return "";
    if (groupName === "platforms" && item?.abbreviation && item.abbreviation !== getTaxonomyDisplayName(groupName, item)) {
      return item.abbreviation;
    }
    return "";
  }

  function mergeExtraTaxonomySuggestions(groupName, query, items) {
    const extras = EXTRA_TAXONOMY_SUGGESTIONS[groupName] || [];
    if (!extras.length) return items;

    const queryText = normalizeSearchValue(query);
    const merged = [...items];
    extras.forEach((item) => {
      const values = [
        item.name,
        item.slug,
        TAXONOMY_I18N[groupName]?.[item.name],
      ].filter(Boolean);
      const matches = values.some((value) => normalizeSearchValue(value).includes(queryText) || queryText.includes(normalizeSearchValue(value)));
      if (!matches) return;

      const exists = merged.some((current) => normalizeSearchValue(current.name) === normalizeSearchValue(item.name));
      if (!exists) merged.unshift(item);
    });
    return merged;
  }

  function renderAvatar(profile) {
    if (profile.avatar_url) {
      return `<span class="user-search-avatar"><img src="${escapeHtml(profile.avatar_url)}" alt=""></span>`;
    }

    return `<span class="user-search-avatar">${escapeHtml(getInitials(profile.display_name || profile.username))}</span>`;
  }

  function renderResult(profile) {
    const displayName = profile.display_name || profile.username || "Usuário Gimerr";
    const username = profile.username ? `@${profile.username}` : "Perfil público";
    const nameLine = profile.display_name
      ? `<strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(username)}</span>`
      : `<strong>${escapeHtml(username)}</strong>`;

    return `
      <a class="user-search-result" href="${getPublicProfileUrl(profile)}">
        ${renderAvatar(profile)}
        <span class="user-search-copy">${nameLine}</span>
      </a>
    `;
  }

  function renderGameResult(game) {
    const platforms = Array.isArray(game.platforms)
      ? game.platforms.slice(0, 3).map((platform) => platform.abbreviation || platform.name).filter(Boolean).join(", ")
      : "";
    const meta = platforms || game.firstReleaseDate || "Jogo";

    return `
      <a class="user-search-result game-search-result" href="${getGameUrl(game)}">
        <span class="user-search-avatar game-search-cover">
          ${game.coverUrl ? `<img src="${escapeHtml(game.coverUrl)}" alt="">` : escapeHtml(getInitials(game.name))}
        </span>
        <span class="user-search-copy">
          <strong>${escapeHtml(game.name)}</strong>
          <span>${escapeHtml(meta)}</span>
        </span>
      </a>
    `;
  }

  function createGameRequestModal() {
    let coverFile = null;
    let coverObjectUrl = "";
    const coverCrop = { x: 50, y: 50, zoom: 1 };
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.id = "game-request-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <section class="confirm-modal game-request-modal" role="dialog" aria-modal="true" aria-labelledby="game-request-title">
        <div class="modal-head">
          <h2 id="game-request-title">Cadastrar jogo</h2>
          <button class="ghost-icon game-request-close" type="button" aria-label="Fechar">×</button>
        </div>
        <p>Envie as informações principais para análise. Após aprovação, o jogo entra na base do Gimerr.</p>
        <form class="game-request-form" id="game-request-form">
          <div class="field-group">
            <label for="game-request-name">Nome do jogo</label>
            <input id="game-request-name" name="name" type="text" maxlength="140" required placeholder="Nome oficial do jogo">
          </div>
          <div class="field-group">
            <label for="game-request-website">Website</label>
            <input id="game-request-website" name="website" type="url" maxlength="300" required placeholder="https://site-oficial.com">
          </div>
          <div class="field-group">
            <label for="game-request-summary">Descrição</label>
            <textarea id="game-request-summary" name="summary" rows="4" maxlength="1200" placeholder="Descrição curta do jogo"></textarea>
          </div>
          <div class="field-group">
            <label for="game-request-tags">Termos buscados ou tags</label>
            <input id="game-request-tags" name="tags" type="text" maxlength="80" placeholder="Separe os termos e tags por vírgula" data-chip-input="searchTags">
            <small>Até 5 termos.</small>
            <div class="game-request-chip-list" id="game-request-selected-tags"></div>
          </div>
          <div class="game-request-taxonomy-grid">
            <div class="field-group">
              <label for="game-request-genres">Gêneros</label>
              <input id="game-request-genres" name="genres" type="text" maxlength="80" placeholder="Arcade, MOBA, RPG" data-chip-input="genres">
              <small>Até 5 gêneros.</small>
              <div class="game-request-suggestions" id="game-request-genre-suggestions" hidden></div>
              <div class="game-request-chip-list" id="game-request-selected-genres"></div>
            </div>
            <div class="field-group">
              <label for="game-request-platforms">Plataformas</label>
              <input id="game-request-platforms" name="platforms" type="text" maxlength="80" placeholder="Xbox, Playstation 4, PC" data-chip-input="platforms">
              <small>Até 8 plataformas.</small>
              <div class="game-request-suggestions" id="game-request-platform-suggestions" hidden></div>
              <div class="game-request-chip-list" id="game-request-selected-platforms"></div>
            </div>
          </div>
          <div class="game-request-cover-row">
            <div class="game-request-cover-control">
              <div class="game-request-cover-preview" id="game-request-cover-preview">
                <span>Logo</span>
              </div>
              <div class="game-request-cover-sliders" id="game-request-cover-sliders" hidden>
                <label>
                  Zoom
                  <input id="game-request-cover-zoom" type="range" min="100" max="300" value="100">
                </label>
                <label>
                  Horizontal
                  <input id="game-request-cover-x" type="range" min="0" max="100" value="50">
                </label>
                <label>
                  Vertical
                  <input id="game-request-cover-y" type="range" min="0" max="100" value="50">
                </label>
              </div>
            </div>
            <div class="game-request-cover-copy">
              <strong>Logo do jogo</strong>
              <span>Use uma imagem no formato 1:1. JPG, PNG ou WebP até 10 MB.</span>
              <label class="text-button file-button" for="game-request-cover">Enviar logo</label>
              <input id="game-request-cover" type="file" accept="image/jpeg,image/png,image/webp">
            </div>
          </div>
          <p class="field-feedback" id="game-request-feedback" role="status"></p>
          <div class="confirm-modal-actions">
            <button class="text-button" type="button" data-game-request-cancel>Cancelar</button>
            <button class="primary-button" type="submit">Enviar para análise</button>
          </div>
        </form>
      </section>
    `;
    document.body.appendChild(modal);

    const form = modal.querySelector("#game-request-form");
    const nameInput = modal.querySelector("#game-request-name");
    const websiteInput = modal.querySelector("#game-request-website");
    const summaryInput = modal.querySelector("#game-request-summary");
    const tagsInput = modal.querySelector("#game-request-tags");
    const genreInput = modal.querySelector("#game-request-genres");
    const platformInput = modal.querySelector("#game-request-platforms");
    const selectedTagList = modal.querySelector("#game-request-selected-tags");
    const selectedGenreList = modal.querySelector("#game-request-selected-genres");
    const selectedPlatformList = modal.querySelector("#game-request-selected-platforms");
    const genreSuggestions = modal.querySelector("#game-request-genre-suggestions");
    const platformSuggestions = modal.querySelector("#game-request-platform-suggestions");
    const coverInput = modal.querySelector("#game-request-cover");
    const coverPreview = modal.querySelector("#game-request-cover-preview");
    const coverSliders = modal.querySelector("#game-request-cover-sliders");
    const coverZoomInput = modal.querySelector("#game-request-cover-zoom");
    const coverXInput = modal.querySelector("#game-request-cover-x");
    const coverYInput = modal.querySelector("#game-request-cover-y");
    const feedback = modal.querySelector("#game-request-feedback");
    const submitButton = modal.querySelector("button[type='submit']");
    const sourceQueryInput = { value: "" };
    const chipInputs = {
      searchTags: {
        input: tagsInput,
        list: selectedTagList,
        items: [],
        maxItems: GAME_REQUEST_LIMITS.searchTags,
      },
      genres: {
        input: genreInput,
        list: selectedGenreList,
        suggestions: genreSuggestions,
        items: [],
        maxItems: GAME_REQUEST_LIMITS.genres,
        taxonomyType: "genres",
      },
      platforms: {
        input: platformInput,
        list: selectedPlatformList,
        suggestions: platformSuggestions,
        items: [],
        maxItems: GAME_REQUEST_LIMITS.platforms,
        taxonomyType: "platforms",
      },
    };
    const taxonomySearchState = {
      genres: { timer: null, requestId: 0 },
      platforms: { timer: null, requestId: 0 },
    };

    function normalizeChipValue(value) {
      return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40);
    }

    function renderChipInput(groupName) {
      const group = chipInputs[groupName];
      group.list.innerHTML = group.items.map((item) => `
        <button class="game-request-chip" type="button" data-chip-remove="${groupName}" data-value="${escapeHtml(getChipName(item))}">
          ${escapeHtml(group.taxonomyType ? getTaxonomyDisplayName(groupName, typeof item === "string" ? { name: item } : item) : getChipName(item))}
          <span aria-hidden="true">×</span>
        </button>
      `).join("");
    }

    function getChipName(item) {
      return normalizeChipValue(typeof item === "string" ? item : item?.name || "");
    }

    function normalizeTaxonomyChip(item) {
      const name = getChipName(item);
      if (!name) return null;
      if (typeof item === "string") return name;

      const normalized = { name };
      const id = Number(item.id);
      if (id) normalized.id = id;
      if (item.slug) normalized.slug = normalizeChipValue(item.slug);
      if (item.abbreviation) normalized.abbreviation = normalizeChipValue(item.abbreviation);
      return normalized;
    }

    function addChipItem(groupName, item) {
      const group = chipInputs[groupName];
      const normalized = normalizeTaxonomyChip(item);
      const value = getChipName(normalized);
      if (!value) return;
      const exists = group.items.some((current) => getChipName(current).toLowerCase() === value.toLowerCase());
      if (!exists && group.items.length < group.maxItems) group.items.push(normalized);
    }

    function addChip(groupName, rawValue) {
      const group = chipInputs[groupName];
      const values = String(rawValue || "")
        .split(",")
        .map(normalizeChipValue)
        .filter((value) => value.length >= 2);

      values.forEach((value) => {
        addChipItem(groupName, value);
      });

      group.input.value = "";
      hideTaxonomySuggestions(groupName);
      renderChipInput(groupName);
    }

    function removeChip(groupName, value) {
      const group = chipInputs[groupName];
      group.items = group.items.filter((item) => getChipName(item) !== value);
      renderChipInput(groupName);
    }

    function flushChipInputs() {
      Object.keys(chipInputs).forEach((groupName) => {
        if (chipInputs[groupName].input.value.trim()) {
          addChip(groupName, chipInputs[groupName].input.value);
        }
      });
    }

    function getChipItems(groupName) {
      const group = chipInputs[groupName];
      const values = [
        ...group.items,
        ...String(group.input.value || "").split(","),
      ];
      const seen = new Set();
      return values
        .map(normalizeTaxonomyChip)
        .filter((item) => {
          const value = getChipName(item);
          const key = value.toLowerCase();
          if (value.length < 2 || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, group.maxItems);
    }

    function resetChipInputs() {
      Object.keys(chipInputs).forEach((groupName) => {
        chipInputs[groupName].input.value = "";
        chipInputs[groupName].items = [];
        hideTaxonomySuggestions(groupName);
        renderChipInput(groupName);
      });
    }

    function hideTaxonomySuggestions(groupName) {
      const group = chipInputs[groupName];
      if (!group?.suggestions) return;
      group.suggestions.hidden = true;
      group.suggestions.innerHTML = "";
    }

    function renderTaxonomySuggestions(groupName, items, isLoading = false) {
      const group = chipInputs[groupName];
      if (!group?.suggestions) return;

      if (isLoading) {
        group.suggestions.innerHTML = `<div class="game-request-suggestion-loading">Buscando sugestões...</div>`;
        group.suggestions.hidden = false;
        return;
      }

      if (!items.length) {
        group.suggestions.innerHTML = `<div class="game-request-suggestion-loading">Nenhuma sugestão encontrada.</div>`;
        group.suggestions.hidden = false;
        return;
      }

      group.suggestions.innerHTML = items.map((item) => `
        <button
          type="button"
          data-taxonomy-suggestion="${escapeHtml(groupName)}"
          data-id="${escapeHtml(item.id)}"
          data-name="${escapeHtml(item.name)}"
          data-slug="${escapeHtml(item.slug || "")}"
          data-abbreviation="${escapeHtml(item.abbreviation || "")}"
        >
          <strong>${escapeHtml(getTaxonomyDisplayName(groupName, item))}</strong>
          ${getTaxonomyMeta(groupName, item) ? `<span>${escapeHtml(getTaxonomyMeta(groupName, item))}</span>` : ""}
        </button>
      `).join("");
      group.suggestions.hidden = false;
    }

    async function searchTaxonomy(groupName) {
      const group = chipInputs[groupName];
      const taxonomyState = taxonomySearchState[groupName];
      if (!group?.taxonomyType || !taxonomyState) return;

      const query = normalizeChipValue(group.input.value);
      const requestId = ++taxonomyState.requestId;

      if (query.length < 2) {
        hideTaxonomySuggestions(groupName);
        return;
      }

      renderTaxonomySuggestions(groupName, [], true);

      try {
        const response = await fetch(`/api/igdb/taxonomy?type=${encodeURIComponent(group.taxonomyType)}&q=${encodeURIComponent(query)}&limit=8`, {
          headers: { accept: "application/json" },
        });
        const payload = await response.json().catch(() => ({}));
        if (requestId !== taxonomyState.requestId) return;
        if (!response.ok) throw new Error(payload.error || "Não foi possível carregar sugestões.");
        renderTaxonomySuggestions(groupName, mergeExtraTaxonomySuggestions(groupName, query, payload.items || []));
      } catch (error) {
        if (requestId !== taxonomyState.requestId) return;
        group.suggestions.innerHTML = `<div class="game-request-suggestion-loading">${escapeHtml(error.message || "Falha ao buscar sugestões.")}</div>`;
        group.suggestions.hidden = false;
      }
    }

    function scheduleTaxonomySearch(groupName) {
      const taxonomyState = taxonomySearchState[groupName];
      if (!taxonomyState) return;
      clearTimeout(taxonomyState.timer);
      taxonomyState.timer = setTimeout(() => searchTaxonomy(groupName), 220);
    }

    function setFeedback(message, tone = "") {
      feedback.textContent = message || "";
      feedback.className = `field-feedback${tone ? ` is-${tone}` : ""}`;
    }

    function clearCoverPreview() {
      if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = "";
      coverCrop.x = 50;
      coverCrop.y = 50;
      coverCrop.zoom = 1;
      coverZoomInput.value = 100;
      coverXInput.value = 50;
      coverYInput.value = 50;
      coverSliders.hidden = true;
      coverPreview.innerHTML = "<span>Logo</span>";
    }

    function updateCoverCropPreview() {
      const image = coverPreview.querySelector("img");
      if (!image) return;

      coverCrop.x = Number(coverXInput.value);
      coverCrop.y = Number(coverYInput.value);
      coverCrop.zoom = Number(coverZoomInput.value) / 100;

      image.style.objectPosition = `${coverCrop.x}% ${coverCrop.y}%`;
      image.style.transform = `scale(${coverCrop.zoom})`;
      image.style.transformOrigin = `${coverCrop.x}% ${coverCrop.y}%`;
    }

    function loadImageFromFile(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Não foi possível preparar a logo."));
        };
        image.src = url;
      });
    }

    async function compressCoverFile(file) {
      if (!file) return null;
      if (!file.type?.startsWith("image/")) {
        throw new Error("Envie uma imagem válida.");
      }
      if (file.size > GAME_COVER_MAX_SOURCE_BYTES) {
        throw new Error("A logo original deve ter no máximo 10 MB.");
      }

      const image = await loadImageFromFile(file);
      const canvas = document.createElement("canvas");
      canvas.width = GAME_COVER_OUTPUT_SIZE;
      canvas.height = GAME_COVER_OUTPUT_SIZE;
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) {
        throw new Error("Não foi possível preparar a logo para envio.");
      }

      const xPosition = coverCrop.x / 100;
      const yPosition = coverCrop.y / 100;
      const baseScale = Math.max(
        canvas.width / image.naturalWidth,
        canvas.height / image.naturalHeight,
      );
      const scale = baseScale * coverCrop.zoom;
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      const drawX = (canvas.width - drawWidth) * xPosition;
      const drawY = (canvas.height - drawHeight) * yPosition;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", GAME_COVER_WEBP_QUALITY));
      if (!blob) {
        throw new Error("Não foi possível comprimir a logo.");
      }
      if (blob.size > GAME_COVER_MAX_UPLOAD_BYTES) {
        throw new Error("A logo comprimida ainda ficou acima de 2 MB. Use uma imagem menor.");
      }

      const baseName = (file.name || "logo").replace(/\.[^.]+$/, "") || "logo";
      return new File([blob], `${baseName}.webp`, { type: "image/webp" });
    }

    function close() {
      modal.hidden = true;
      setFeedback("");
    }

    function open(term) {
      sourceQueryInput.value = term;
      nameInput.value = term || "";
      websiteInput.value = "";
      summaryInput.value = "";
      tagsInput.value = "";
      genreInput.value = "";
      platformInput.value = "";
      coverInput.value = "";
      coverFile = null;
      resetChipInputs();
      clearCoverPreview();
      setFeedback("");
      modal.hidden = false;
      nameInput.focus();
    }

    async function getAuthToken() {
      const { data } = await window.GimerrAuth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Entre no Gimerr para cadastrar um jogo.");
      return token;
    }

    async function uploadCover(token) {
      if (!coverFile) return { coverUrl: null, coverKey: null };
      const compressedCover = await compressCoverFile(coverFile);

      const formData = new FormData();
      formData.append("file", compressedCover);

      const response = await fetch("/api/game-cover-upload", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
        },
        body: formData,
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível enviar a logo.");
      }

      return {
        coverUrl: payload.url,
        coverKey: payload.key,
      };
    }

    coverInput.addEventListener("change", () => {
      const [file] = coverInput.files;
      coverFile = file || null;
      if (!coverFile) {
        clearCoverPreview();
        return;
      }

      if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = URL.createObjectURL(coverFile);
      coverPreview.innerHTML = `<img src="${coverObjectUrl}" alt="">`;
      coverSliders.hidden = false;
      updateCoverCropPreview();
    });

    [coverZoomInput, coverXInput, coverYInput].forEach((input) => {
      input.addEventListener("input", updateCoverCropPreview);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submitButton.disabled = true;
      submitButton.textContent = "Enviando...";
      setFeedback("Enviando solicitação para análise...");

      try {
        const searchTags = getChipItems("searchTags");
        const genres = getChipItems("genres");
        const platforms = getChipItems("platforms");
        flushChipInputs();
        const token = await getAuthToken();
        const uploadedCover = await uploadCover(token);
        const response = await fetch("/api/game-request-submit", {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            name: nameInput.value,
            websiteUrl: websiteInput.value,
            summary: summaryInput.value,
            searchTags,
            genres,
            platforms,
            sourceQuery: sourceQueryInput.value,
            ...uploadedCover,
          }),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload.error || "Não foi possível cadastrar o jogo.");
        }

        setFeedback("Solicitação enviada. O jogo ficará pendente até análise.", "success");
        form.reset();
        coverFile = null;
        resetChipInputs();
        clearCoverPreview();
      } catch (error) {
        setFeedback(error.message || "Falha ao cadastrar o jogo.", "error");
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Enviar para análise";
      }
    });

    modal.querySelector(".game-request-close").addEventListener("click", close);
    modal.querySelector("[data-game-request-cancel]").addEventListener("click", close);
    modal.addEventListener("input", (event) => {
      const input = event.target.closest("[data-chip-input]");
      if (!input) return;
      const groupName = input.dataset.chipInput;

      if (chipInputs[groupName]?.taxonomyType && !input.value.includes(",")) {
        scheduleTaxonomySearch(groupName);
      }

      if (!input.value.includes(",")) return;
      addChip(input.dataset.chipInput, input.value);
    });
    modal.addEventListener("keydown", (event) => {
      const input = event.target.closest("[data-chip-input]");
      if (!input) return;

      if (event.key === "Enter") {
        event.preventDefault();
        addChip(input.dataset.chipInput, input.value);
      }

      if (event.key === "Backspace" && !input.value) {
        const group = chipInputs[input.dataset.chipInput];
        group.items.pop();
        renderChipInput(input.dataset.chipInput);
      }
    });
    modal.addEventListener("blur", (event) => {
      const input = event.target.closest("[data-chip-input]");
      if (!input) return;
      const groupName = input.dataset.chipInput;
      if (chipInputs[groupName]?.taxonomyType) return;
      addChip(groupName, input.value);
    }, true);
    modal.addEventListener("click", (event) => {
      const suggestion = event.target.closest("[data-taxonomy-suggestion]");
      if (suggestion) {
        const groupName = suggestion.dataset.taxonomySuggestion;
        addChipItem(groupName, {
          id: suggestion.dataset.id,
          name: suggestion.dataset.name,
          slug: suggestion.dataset.slug,
          abbreviation: suggestion.dataset.abbreviation,
        });
        chipInputs[groupName].input.value = "";
        hideTaxonomySuggestions(groupName);
        renderChipInput(groupName);
        return;
      }

      const remove = event.target.closest("[data-chip-remove]");
      if (remove) {
        removeChip(remove.dataset.chipRemove, remove.dataset.value);
      }
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });

    return { open };
  }

  let gameRequestModal = null;

  function openGameRequestModal(term) {
    if (!gameRequestModal) {
      gameRequestModal = createGameRequestModal();
    }

    gameRequestModal.open(term);
  }

  window.GimerrGameRequest = {
    open: openGameRequestModal,
  };
  window.addEventListener("gimerr:open-game-request", (event) => {
    openGameRequestModal(event.detail?.term || "");
  });

  function createSearchController(input) {
    const shell = input.closest(".search-box");
    if (!shell) return null;

    const popover = document.createElement("div");
    popover.className = "user-search-popover";
    popover.hidden = true;
    popover.setAttribute("role", "listbox");
    shell.appendChild(popover);

    const controller = {
      input,
      popover,
      timer: null,
      requestId: 0,
      results: [],
      gameResults: [],
      lastTerm: "",
    };

    function hide() {
      popover.hidden = true;
    }

    function showMessage(message) {
      popover.innerHTML = `<div class="user-search-message">${escapeHtml(message)}</div>`;
      popover.hidden = false;
    }

    function renderRemoteGameSearchAction(term) {
      return `
        <button class="user-search-result user-search-action user-search-action-text" type="button" data-remote-game-search>
          <span class="user-search-copy">
            <strong>Pesquisar por '${escapeHtml(term)}'</strong>
            <span>Buscar na base de jogos</span>
          </span>
        </button>
      `;
    }

    function renderGameSubmitAction(term) {
      return `
        <button class="user-search-result user-search-action user-search-action-text" type="button" data-game-submit>
          <span class="user-search-copy">
            <span>${escapeHtml(getGameSubmitLabel(term))} <span class="user-search-action-highlight">clique aqui para cadastrá-lo</span></span>
          </span>
        </button>
      `;
    }

    function render(users, games = [], options = {}) {
      controller.results = users;
      controller.gameResults = games;

      const gameAction = options.gameAction === "submit"
        ? renderGameSubmitAction(controller.lastTerm)
        : options.gameAction === "remote"
          ? renderRemoteGameSearchAction(controller.lastTerm)
          : "";

      popover.innerHTML = `
        ${users.length ? `<div class="user-search-section">Usuários</div>${users.map(renderResult).join("")}` : ""}
        ${games.length || gameAction ? `<div class="user-search-section">Jogos</div>${games.map(renderGameResult).join("")}${gameAction}` : ""}
      `;
      popover.hidden = false;
    }

    async function runSearch(options = {}) {
      const term = sanitizeSearchTerm(input.value);
      const requestId = ++controller.requestId;
      controller.lastTerm = term;

      if (term.length < SEARCH_MIN_LENGTH) {
        controller.results = [];
        controller.gameResults = [];
        hide();
        return;
      }

      showMessage(options.forceRemote ? "Buscando na base de jogos..." : "Buscando no Gimerr...");

      try {
        const client = await window.GimerrAuth.getClient();
        const likeTerm = `*${term}*`;
        const [userResult, gameResponse, currentUserId] = await Promise.all([
          client
            .from("public_profiles")
            .select("id, display_name, username, avatar_url")
            .or(`display_name.ilike.${likeTerm},username.ilike.${likeTerm}`)
            .limit(SEARCH_LIMIT + 1),
          fetch(`/api/games/search?q=${encodeURIComponent(term)}&limit=${SEARCH_LIMIT}${options.forceRemote ? "&force=1" : ""}`, {
            headers: { accept: "application/json" },
          }),
          getCurrentUserId(),
        ]);

        if (requestId !== controller.requestId) return;
        if (userResult.error) throw userResult.error;

        const gamePayload = await gameResponse.json().catch(() => ({}));
        if (!gameResponse.ok) {
          console.warn("Não foi possível buscar jogos.", gamePayload.error || gameResponse.status);
        }

        const users = (userResult.data || [])
          .filter((profile) => String(profile.id || "") !== String(currentUserId || ""))
          .slice(0, SEARCH_LIMIT);
        const games = gameResponse.ok ? (gamePayload.games || []) : [];

        if (options.forceRemote && !games.length) {
          render([], [], { gameAction: "submit" });
          return;
        }

        render(users, games, {
          gameAction: games.length ? "" : options.forceRemote ? "submit" : "remote",
        });
      } catch (error) {
        console.warn("Não foi possível buscar no Gimerr.", error);
        if (requestId === controller.requestId) showMessage("Não foi possível carregar a busca agora.");
      }
    }

    input.addEventListener("input", () => {
      clearTimeout(controller.timer);
      controller.timer = setTimeout(runSearch, 220);
    });

    input.addEventListener("focus", () => {
      if (controller.results.length) {
        popover.hidden = false;
      } else if (sanitizeSearchTerm(input.value).length >= SEARCH_MIN_LENGTH) {
        runSearch();
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hide();
        input.blur();
        return;
      }

      if (event.key === "Enter" && (controller.results[0] || controller.gameResults[0])) {
        event.preventDefault();
        window.location.assign(controller.results[0]
          ? getPublicProfileUrl(controller.results[0])
          : getGameUrl(controller.gameResults[0]));
        return;
      }

      if (event.key === "Enter" && sanitizeSearchTerm(input.value).length >= SEARCH_MIN_LENGTH) {
        event.preventDefault();
        runSearch({ forceRemote: true });
      }
    });

    popover.addEventListener("click", (event) => {
      if (event.target.closest("[data-remote-game-search]")) {
        runSearch({ forceRemote: true });
        return;
      }

      if (event.target.closest("[data-game-submit]")) {
        openGameRequestModal(controller.lastTerm);
      }
    });

    return controller;
  }

  const controllers = inputs.map(createSearchController).filter(Boolean);

  document.addEventListener("click", (event) => {
    controllers.forEach((controller) => {
      if (!controller.popover.closest(".search-box")?.contains(event.target)) {
        controller.popover.hidden = true;
      }
    });
  });
})();
