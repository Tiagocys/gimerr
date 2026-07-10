(function initAdminPage() {
  const els = {
    filter: document.querySelector("#admin-status-filter"),
    feedback: document.querySelector("#admin-feedback"),
    list: document.querySelector("#admin-request-list"),
    tabs: document.querySelectorAll("[data-admin-tab]"),
    panels: document.querySelectorAll("[data-admin-panel]"),
    reportFilter: document.querySelector("#admin-report-status-filter"),
    reportFeedback: document.querySelector("#admin-report-feedback"),
    reportList: document.querySelector("#admin-report-list"),
  };

  if (!window.GimerrAuth || !els.filter || !els.feedback || !els.list) return;

  const state = {
    session: null,
    requests: [],
    reports: [],
    reportsLoaded: false,
    taxonomy: {
      genres: [],
      platforms: [],
    },
    taxonomyLoaded: false,
  };

  const TAXONOMY_LIMITS = {
    genres: 5,
    platforms: 8,
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setFeedback(message, tone = "") {
    els.feedback.textContent = message || "";
    els.feedback.className = `admin-feedback${tone ? ` is-${tone}` : ""}`;
  }

  function setReportFeedback(message, tone = "") {
    els.reportFeedback.textContent = message || "";
    els.reportFeedback.className = `admin-feedback${tone ? ` is-${tone}` : ""}`;
  }

  function formatAdminDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }

  function reportProfileLabel(profile) {
    if (!profile) return "Usuário indisponível";
    const handle = profile.username ? `@${profile.username}` : "";
    return [profile.displayName, handle].filter(Boolean).join(" · ");
  }

  function reportResolutionLabel(resolution) {
    if (resolution === "suspended_7_days") return "Conta suspensa por 7 dias";
    if (resolution === "post_deleted") return "Post excluído";
    if (resolution === "user_banned") return "Usuário banido";
    if (resolution === "ignored") return "Denúncia ignorada";
    return "Pendente";
  }

  function accountStatusLabel(status) {
    if (status === "suspended") return "suspensa";
    if (status === "banned") return "banida";
    if (status === "inactive") return "inativa";
    return "ativa";
  }

  function renderReportMedia(report) {
    const post = report.post || {};
    if (!post.exists && report.resolution === "post_deleted") {
      return `<div class="admin-report-media-placeholder">Post removido</div>`;
    }
    if (!post.mediaUrl) return `<div class="admin-report-media-placeholder">Sem mídia</div>`;
    if (post.mediaType?.startsWith("video/")) {
      return `<video src="${escapeHtml(post.mediaUrl)}" ${post.thumbnailUrl ? `poster="${escapeHtml(post.thumbnailUrl)}"` : ""} controls playsinline preload="metadata"></video>`;
    }
    return `<img src="${escapeHtml(post.mediaUrl)}" alt="Mídia denunciada">`;
  }

  function renderReportCard(report) {
    const pending = report.status === "pending";
    const targetStatus = report.reportedUser?.status && report.reportedUser.status !== "active"
      ? ` · Conta ${accountStatusLabel(report.reportedUser.status)}`
      : "";
    return `
      <article class="admin-report-card" data-report-id="${escapeHtml(report.id)}">
        <div class="admin-report-media">${renderReportMedia(report)}</div>
        <div class="admin-report-body">
          <div class="admin-request-title-row">
            <div>
              <h2>${escapeHtml(report.post?.type === "video" ? "Vídeo denunciado" : report.post?.type === "listing" ? "Anúncio denunciado" : "Post denunciado")}</h2>
              <p>Denunciado em ${escapeHtml(formatAdminDate(report.createdAt))}</p>
            </div>
            <span class="status-pill ${pending ? "pending" : "approved"}">${escapeHtml(pending ? "Pendente" : reportResolutionLabel(report.resolution))}</span>
          </div>
          <dl class="admin-report-details">
            <div><dt>Denunciante</dt><dd>${escapeHtml(reportProfileLabel(report.reporter))}</dd></div>
            <div><dt>Autor do post</dt><dd>${escapeHtml(reportProfileLabel(report.reportedUser))}${escapeHtml(targetStatus)}</dd></div>
            <div><dt>Motivo</dt><dd>${escapeHtml(report.reason)}</dd></div>
            ${report.post?.body ? `<div><dt>Texto do post</dt><dd>${escapeHtml(report.post.body)}</dd></div>` : ""}
            ${report.reviewedAt ? `<div><dt>Analisada em</dt><dd>${escapeHtml(formatAdminDate(report.reviewedAt))}</dd></div>` : ""}
          </dl>
          ${pending ? `
            <label class="admin-review-note">
              Observação da moderação
              <textarea rows="2" maxlength="800" data-report-note placeholder="Opcional"></textarea>
            </label>
            <div class="admin-report-actions">
              <button class="text-button" type="button" data-report-action="suspend_7_days">Suspender por 7 dias</button>
              <button class="text-button danger-button" type="button" data-report-action="delete_post">Excluir post</button>
              <button class="primary-button admin-ban-button" type="button" data-report-action="ban_user">Banir permanentemente</button>
              <button class="text-button" type="button" data-report-action="ignore">Ignorar denúncia</button>
            </div>
          ` : report.resolutionNote ? `<p class="admin-report-resolution-note">${escapeHtml(report.resolutionNote)}</p>` : ""}
        </div>
      </article>
    `;
  }

  function renderReports() {
    if (!state.reports.length) {
      els.reportList.innerHTML = `<div class="empty-state">Nenhuma denúncia encontrada.</div>`;
      return;
    }
    els.reportList.innerHTML = state.reports.map(renderReportCard).join("");
  }

  async function loadReports() {
    setReportFeedback("Carregando denúncias...");
    try {
      const token = await getAuthToken();
      const response = await fetch(`/api/admin-post-reports?status=${encodeURIComponent(els.reportFilter.value)}`, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar denúncias.");
      state.reports = payload.reports || [];
      state.reportsLoaded = true;
      setReportFeedback(`${state.reports.length} denúncia(ões) carregada(s).`, "success");
      renderReports();
    } catch (error) {
      setReportFeedback(error.message || "Falha ao carregar denúncias.", "error");
      els.reportList.innerHTML = "";
    }
  }

  function getReportConfirmation(action) {
    if (action === "suspend_7_days") return "Suspender esta conta por 7 dias?";
    if (action === "delete_post") return "Excluir permanentemente este post e sua mídia?";
    if (action === "ban_user") return "Banir permanentemente esta conta? Esta é uma ação grave.";
    return "Ignorar esta denúncia e notificar o denunciante?";
  }

  async function applyReportAction(card, action) {
    if (!window.confirm(getReportConfirmation(action))) return;
    const buttons = card.querySelectorAll("[data-report-action]");
    buttons.forEach((button) => { button.disabled = true; });
    setReportFeedback("Aplicando moderação...");
    try {
      const token = await getAuthToken();
      const response = await fetch("/api/admin-post-report-action", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reportId: card.dataset.reportId,
          action,
          note: card.querySelector("[data-report-note]")?.value || "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível aplicar moderação.");
      setReportFeedback("Ação de moderação aplicada.", "success");
      await loadReports();
    } catch (error) {
      setReportFeedback(error.message || "Falha ao aplicar moderação.", "error");
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function setAdminTab(tab) {
    els.tabs.forEach((button) => button.classList.toggle("is-active", button.dataset.adminTab === tab));
    els.panels.forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== tab; });
    if (tab === "reports" && !state.reportsLoaded) loadReports();
  }

  function getSubmitterName(submitter) {
    if (!submitter) return "Usuário Gimerr";
    return submitter.display_name || submitter.username || "Usuário Gimerr";
  }

  function renderPills(items) {
    if (!Array.isArray(items) || !items.length) return "";
    return `
      <div class="admin-pill-list">
        ${items.map((item) => `<span>${escapeHtml(typeof item === "string" ? item : item?.name || "")}</span>`).join("")}
      </div>
    `;
  }

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isTaxonomySelected(selectedItems, item) {
    if (!Array.isArray(selectedItems)) return false;
    const itemId = Number(item?.id);
    const itemName = normalizeName(item?.name);
    return selectedItems.some((selected) => {
      const selectedId = Number(selected?.id);
      if (itemId && selectedId && itemId === selectedId) return true;
      return itemName && normalizeName(selected?.name || selected) === itemName;
    });
  }

  function getTaxonomyLabel(item, type) {
    if (type === "platforms" && item.abbreviation) {
      return `${item.name} (${item.abbreviation})`;
    }
    return item.name;
  }

  function renderTaxonomyOptions(type, selectedItems, canEdit) {
    const items = state.taxonomy[type] || [];
    if (!items.length) {
      return `<p class="admin-taxonomy-empty">Carregando lista da IGDB...</p>`;
    }

    const unmatchedSelectedItems = (selectedItems || []).filter((selected) => (
      !items.some((item) => isTaxonomySelected([selected], item))
    ));
    const currentOptions = unmatchedSelectedItems.map((item) => `
      <label class="admin-taxonomy-option is-current">
        <input
          type="checkbox"
          data-taxonomy-choice
          data-taxonomy-type="${escapeHtml(type)}"
          data-id="${escapeHtml(item?.id || "")}"
          data-name="${escapeHtml(typeof item === "string" ? item : item?.name || "")}"
          data-slug="${escapeHtml(item?.slug || "")}"
          data-abbreviation="${escapeHtml(item?.abbreviation || "")}"
          checked
          ${canEdit ? "" : "disabled"}
        >
        <span>${escapeHtml(typeof item === "string" ? item : item?.name || "")} <small>enviado</small></span>
      </label>
    `).join("");

    const igdbOptions = items.map((item) => {
      const checked = isTaxonomySelected(selectedItems, item);
      return `
        <label class="admin-taxonomy-option">
          <input
            type="checkbox"
            data-taxonomy-choice
            data-taxonomy-type="${escapeHtml(type)}"
            data-id="${escapeHtml(item.id)}"
            data-name="${escapeHtml(item.name)}"
            data-slug="${escapeHtml(item.slug || "")}"
            data-abbreviation="${escapeHtml(item.abbreviation || "")}"
            ${checked ? "checked" : ""}
            ${canEdit ? "" : "disabled"}
          >
          <span>${escapeHtml(getTaxonomyLabel(item, type))}</span>
        </label>
      `;
    }).join("");

    return `${currentOptions}${igdbOptions}`;
  }

  function renderTaxonomyEditor(type, title, selectedItems, canEdit) {
    const limit = TAXONOMY_LIMITS[type];
    return `
      <details class="admin-taxonomy-panel" data-taxonomy-panel="${escapeHtml(type)}">
        <summary>
          <span>${escapeHtml(title)}</span>
          <small data-taxonomy-count="${escapeHtml(type)}">0/${limit}</small>
        </summary>
        <div class="admin-taxonomy-current" data-taxonomy-current="${escapeHtml(type)}">
          ${renderPills(selectedItems)}
        </div>
        <input
          class="admin-taxonomy-filter"
          type="search"
          data-taxonomy-filter="${escapeHtml(type)}"
          placeholder="Filtrar ${type === "genres" ? "gêneros" : "plataformas"}"
        >
        <div class="admin-taxonomy-list">
          ${renderTaxonomyOptions(type, selectedItems, canEdit)}
        </div>
      </details>
    `;
  }

  function renderRequestCard(request) {
    const submitter = getSubmitterName(request.submittedBy);
    const createdAt = request.createdAt
      ? new Date(request.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : "";
    const canReview = request.status === "pending";

    return `
      <article class="admin-request-card" data-request-id="${escapeHtml(request.id)}">
        <div class="admin-request-media">
          ${request.coverUrl ? `<img src="${escapeHtml(request.coverUrl)}" alt="">` : `<span>${escapeHtml(request.name.slice(0, 2).toUpperCase())}</span>`}
        </div>
        <div class="admin-request-body">
          <div class="admin-request-title-row">
            <div>
              <h2>${escapeHtml(request.name)}</h2>
              <p>Enviado por ${escapeHtml(submitter)}${createdAt ? ` em ${escapeHtml(createdAt)}` : ""}</p>
            </div>
            <span class="status-pill ${escapeHtml(request.status)}">${escapeHtml(request.status)}</span>
          </div>

          <a class="admin-request-link" href="${escapeHtml(request.websiteUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(request.websiteUrl)}</a>
          ${request.summary ? `<p class="admin-request-summary">${escapeHtml(request.summary)}</p>` : ""}

          <div class="admin-request-editor">
            <label class="admin-edit-field">
              <span>Termos buscados</span>
              <input
                type="text"
                maxlength="120"
                data-admin-search-tags
                value="${escapeHtml((request.searchTags || []).join(", "))}"
                placeholder="Até 5 termos separados por vírgula"
                ${canReview ? "" : "disabled"}
              >
            </label>
            <div class="admin-taxonomy-grid">
              ${renderTaxonomyEditor("genres", "Gêneros registrados na IGDB", request.genres || [], canReview)}
              ${renderTaxonomyEditor("platforms", "Plataformas registradas na IGDB", request.platforms || [], canReview)}
            </div>
          </div>

          <label class="admin-review-note">
            Observação da análise
            <textarea rows="3" maxlength="800" placeholder="Opcional">${escapeHtml(request.reviewNotes || "")}</textarea>
          </label>

          <div class="admin-request-actions">
            <button class="text-button" type="button" data-admin-action="update" ${canReview ? "" : "disabled"}>Salvar ajustes</button>
            <button class="primary-button" type="button" data-admin-action="approve" ${canReview ? "" : "disabled"}>Aprovar</button>
            <button class="text-button danger-button" type="button" data-admin-action="reject" ${canReview ? "" : "disabled"}>Rejeitar</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderRequests() {
    if (!state.requests.length) {
      els.list.innerHTML = `<div class="empty-state">Nenhuma solicitação encontrada.</div>`;
      return;
    }

    els.list.innerHTML = state.requests.map(renderRequestCard).join("");
    updateTaxonomyCounts();
  }

  async function loadTaxonomy() {
    if (state.taxonomyLoaded) return;

    const [genresRes, platformsRes] = await Promise.all([
      fetch("/api/igdb/taxonomy?type=genres&limit=500", { headers: { accept: "application/json" } }),
      fetch("/api/igdb/taxonomy?type=platforms&limit=500", { headers: { accept: "application/json" } }),
    ]);
    const [genresPayload, platformsPayload] = await Promise.all([
      genresRes.json().catch(() => ({})),
      platformsRes.json().catch(() => ({})),
    ]);

    if (!genresRes.ok) throw new Error(genresPayload.error || "Não foi possível carregar gêneros da IGDB.");
    if (!platformsRes.ok) throw new Error(platformsPayload.error || "Não foi possível carregar plataformas da IGDB.");

    state.taxonomy.genres = genresPayload.items || [];
    state.taxonomy.platforms = platformsPayload.items || [];
    state.taxonomyLoaded = true;
  }

  async function getAuthToken() {
    const { data } = await window.GimerrAuth.getSession();
    state.session = data.session;
    const token = data.session?.access_token;
    if (!token) throw new Error("Entre com uma conta administradora para acessar esta página.");
    return token;
  }

  async function loadRequests() {
    setFeedback("Carregando solicitações...");

    try {
      const token = await getAuthToken();
      await loadTaxonomy();
      const response = await fetch(`/api/admin-game-requests?status=${encodeURIComponent(els.filter.value)}`, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível carregar solicitações.");
      }

      state.requests = payload.requests || [];
      setFeedback(`${state.requests.length} solicitação(ões) carregada(s).`, "success");
      renderRequests();
    } catch (error) {
      setFeedback(error.message || "Falha ao carregar solicitações.", "error");
      els.list.innerHTML = "";
    }
  }

  function parseSearchTags(value) {
    const seen = new Set();
    return String(value || "")
      .split(",")
      .map((item) => item.replace(/\s+/g, " ").trim().toLowerCase())
      .filter((item) => {
        if (item.length < 2 || seen.has(item)) return false;
        seen.add(item);
        return true;
      })
      .slice(0, 5);
  }

  function getSelectedTaxonomyItems(card, type) {
    return Array.from(card.querySelectorAll(`[data-taxonomy-choice][data-taxonomy-type="${type}"]:checked`))
      .map((input) => {
        const id = Number(input.dataset.id);
        const item = {
          name: input.dataset.name || "",
        };
        if (id) item.id = id;
        if (input.dataset.slug) item.slug = input.dataset.slug;
        if (input.dataset.abbreviation) item.abbreviation = input.dataset.abbreviation;
        return item;
      });
  }

  function getRequestEdits(card) {
    return {
      id: card.dataset.requestId,
      searchTags: parseSearchTags(card.querySelector("[data-admin-search-tags]")?.value || ""),
      genres: getSelectedTaxonomyItems(card, "genres"),
      platforms: getSelectedTaxonomyItems(card, "platforms"),
    };
  }

  function setActionButtonState(button, isSaving, label) {
    if (!button) return;
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.disabled = isSaving;
    button.textContent = isSaving ? label : button.dataset.originalText;
  }

  async function saveRequestEdits(card, token, options = {}) {
    const response = await fetch("/api/admin-game-request-update", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(getRequestEdits(card)),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "Não foi possível salvar ajustes.");
    }

    if (!options.silent) {
      setFeedback("Ajustes salvos.", "success");
      await loadRequests();
    }
  }

  async function updateRequest(card) {
    const button = card.querySelector('[data-admin-action="update"]');
    setActionButtonState(button, true, "Salvando...");
    setFeedback("Salvando ajustes...");

    try {
      const token = await getAuthToken();
      await saveRequestEdits(card, token);
    } catch (error) {
      setFeedback(error.message || "Falha ao salvar ajustes.", "error");
      setActionButtonState(button, false);
    }
  }

  async function reviewRequest(card, action) {
    const id = card.dataset.requestId;
    const note = card.querySelector("textarea")?.value || "";
    const button = card.querySelector(`[data-admin-action="${action}"]`);
    button.disabled = true;
    button.textContent = action === "approve" ? "Aprovando..." : "Rejeitando...";
    setFeedback("Salvando análise...");

    try {
      const token = await getAuthToken();
      await saveRequestEdits(card, token, { silent: true });
      const response = await fetch("/api/admin-game-request-review", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id,
          action,
          reviewNotes: note,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível salvar análise.");
      }

      setFeedback(action === "approve" ? "Jogo aprovado e enviado para a base." : "Solicitação rejeitada.", "success");
      await loadRequests();
    } catch (error) {
      setFeedback(error.message || "Falha ao salvar análise.", "error");
      button.disabled = false;
      button.textContent = action === "approve" ? "Aprovar" : "Rejeitar";
    }
  }

  els.filter.addEventListener("change", loadRequests);
  els.reportFilter.addEventListener("change", loadReports);
  els.tabs.forEach((button) => {
    button.addEventListener("click", () => setAdminTab(button.dataset.adminTab));
  });
  els.reportList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-action]");
    if (!button) return;
    const card = button.closest("[data-report-id]");
    if (!card) return;
    applyReportAction(card, button.dataset.reportAction);
  });
  els.list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-admin-action]");
    if (!button) return;
    const card = button.closest("[data-request-id]");
    if (!card) return;
    if (button.dataset.adminAction === "update") {
      updateRequest(card);
      return;
    }
    reviewRequest(card, button.dataset.adminAction);
  });
  els.list.addEventListener("change", (event) => {
    const input = event.target.closest("[data-taxonomy-choice]");
    if (!input) return;

    const card = input.closest("[data-request-id]");
    const type = input.dataset.taxonomyType;
    const limit = TAXONOMY_LIMITS[type];
    const selected = getSelectedTaxonomyItems(card, type);
    if (selected.length > limit) {
      input.checked = false;
      setFeedback(type === "genres" ? `Escolha no máximo ${limit} gêneros.` : `Escolha no máximo ${limit} plataformas.`, "error");
    }
    updateTaxonomyCounts(card);
  });
  els.list.addEventListener("input", (event) => {
    const filter = event.target.closest("[data-taxonomy-filter]");
    if (!filter) return;

    const panel = filter.closest("[data-taxonomy-panel]");
    const query = normalizeName(filter.value);
    panel.querySelectorAll(".admin-taxonomy-option").forEach((option) => {
      const text = normalizeName(option.textContent);
      option.hidden = Boolean(query) && !text.includes(query);
    });
  });

  function updateTaxonomyCounts(root = els.list) {
    root.querySelectorAll("[data-taxonomy-panel]").forEach((panel) => {
      const type = panel.dataset.taxonomyPanel;
      const limit = TAXONOMY_LIMITS[type];
      const count = panel.querySelectorAll(`[data-taxonomy-choice][data-taxonomy-type="${type}"]:checked`).length;
      const countEl = panel.querySelector(`[data-taxonomy-count="${type}"]`);
      if (countEl) countEl.textContent = `${count}/${limit}`;
    });
  }

  loadRequests();
})();
