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
    ticketFilter: document.querySelector("#admin-ticket-status-filter"),
    ticketFeedback: document.querySelector("#admin-ticket-feedback"),
    ticketList: document.querySelector("#admin-ticket-list"),
    ticketThread: document.querySelector("#admin-ticket-thread"),
    reportsBadge: document.querySelector("#admin-reports-badge"),
    ticketsBadge: document.querySelector("#admin-tickets-badge"),
  };

  if (!window.GimerrAuth || !els.filter || !els.feedback || !els.list) return;

  const state = {
    session: null,
    requests: [],
    reports: [],
    reportsLoaded: false,
    tickets: [],
    ticketsLoaded: false,
    selectedTicketId: "",
    badgesLoading: false,
    taxonomy: {
      genres: [],
      platforms: [],
    },
    taxonomyLoaded: false,
    taxonomyError: "",
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

  function setTicketFeedback(message, tone = "") {
    els.ticketFeedback.textContent = message || "";
    els.ticketFeedback.className = `admin-feedback${tone ? ` is-${tone}` : ""}`;
  }

  function formatBadgeCount(value) {
    const count = Number(value || 0);
    if (count >= 100) return "99+";
    return String(Math.max(0, count));
  }

  function setTabBadge(element, count) {
    if (!element) return;
    const numericCount = Number(count || 0);
    element.hidden = numericCount <= 0;
    element.textContent = formatBadgeCount(numericCount);
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
    const attachment = report.attachments?.[0];
    if (!attachment?.mediaUrl) return `<div class="admin-report-media-placeholder">Sem mídia</div>`;
    return `<img src="${escapeHtml(attachment.mediaUrl)}" alt="Imagem anexada pelo denunciante">`;
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

  function ticketStatusLabel(status) {
    if (status === "reopened") return "Reaberto";
    if (status === "resolved") return "Resolvido";
    if (status === "closed") return "Encerrado";
    return "Aberto";
  }

  function renderTicketButton(ticket) {
    const requester = ticket.requester;
    const requesterLabel = requester
      ? [requester.displayName, requester.username ? `@${requester.username}` : ""].filter(Boolean).join(" · ")
      : "Usuário indisponível";
    const latest = ticket.latestMessage?.body || "Sem mensagens no caso.";
    return `
      <button class="admin-ticket-item${ticket.id === state.selectedTicketId ? " is-active" : ""}" type="button" data-ticket-id="${escapeHtml(ticket.id)}">
        <span class="admin-ticket-item-head">
          <strong>${escapeHtml(ticket.sourceLabel || ticket.title)}</strong>
          <span class="status-pill ${escapeHtml(ticket.status)}">${escapeHtml(ticketStatusLabel(ticket.status))}</span>
        </span>
        <span>${escapeHtml(requesterLabel)}</span>
        <small>${escapeHtml(latest)}</small>
      </button>
    `;
  }

  function renderTickets() {
    if (!state.tickets.length) {
      state.selectedTicketId = "";
      els.ticketList.innerHTML = `<div class="empty-state">Nenhum caso encontrado.</div>`;
      els.ticketThread.innerHTML = `<div class="empty-state">Selecione um caso para ver a conversa.</div>`;
      return;
    }
    els.ticketList.innerHTML = state.tickets.map(renderTicketButton).join("");
    if (!state.selectedTicketId || !state.tickets.some((ticket) => ticket.id === state.selectedTicketId)) {
      state.selectedTicketId = state.tickets[0].id;
      loadTicketThread(state.selectedTicketId);
    }
  }

  function renderTicketMessage(message) {
    const author = message.author;
    const label = author ? [author.displayName, author.username ? `@${author.username}` : ""].filter(Boolean).join(" · ") : "Gimerr";
    return `
      <article class="admin-ticket-message">
        <header>
          <strong>${escapeHtml(label)}</strong>
          <time>${escapeHtml(formatAdminDate(message.createdAt))}</time>
        </header>
        ${message.mediaUrl ? `<a class="admin-ticket-message-image" href="${escapeHtml(message.mediaUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(message.mediaUrl)}" alt="Imagem anexada à denúncia"></a>` : ""}
        ${message.body ? `<p>${escapeHtml(message.body)}</p>` : ""}
      </article>
    `;
  }

  function renderTicketSourceMedia(source) {
    const post = source?.post || {};
    const imageUrl = post.thumbnailUrl || post.mediaUrl || "";
    if (imageUrl && /^image\//.test(post.mediaType || "") || post.thumbnailUrl) {
      return `<img src="${escapeHtml(imageUrl)}" alt="">`;
    }
    if (imageUrl) return `<img src="${escapeHtml(imageUrl)}" alt="">`;
    return `<div class="admin-ticket-source-placeholder">Sem imagem</div>`;
  }

  function renderTicketSource(source) {
    if (!source) return "";
    if (source.type === "post_report") {
      const profile = source.profile;
      const profileLabel = profile
        ? [profile.displayName, profile.username ? `@${profile.username}` : ""].filter(Boolean).join(" · ")
        : "Autor indisponível";
      const profileHtml = profile?.id
        ? `<a class="admin-ticket-source-profile-link" href="./profile?id=${encodeURIComponent(profile.id)}" target="_blank" rel="noopener">${escapeHtml(profileLabel)}</a>`
        : `<span>${escapeHtml(profileLabel)}</span>`;
      return `
        <article class="admin-ticket-source-card">
          <div class="admin-ticket-source-media">${renderTicketSourceMedia(source)}</div>
          <div class="admin-ticket-source-body">
            <strong>${escapeHtml(source.label || "Anúncio denunciado")}</strong>
            <p>${profileHtml}</p>
            ${source.post?.body ? `<p>${escapeHtml(source.post.body)}</p>` : ""}
            <dl>
              <div><dt>Motivo</dt><dd>${escapeHtml(source.reason || "Sem motivo informado.")}</dd></div>
              ${source.post?.id ? `<div><dt>Post</dt><dd><a href="./post?id=${encodeURIComponent(source.post.id)}" target="_blank" rel="noopener">Abrir anúncio</a></dd></div>` : ""}
            </dl>
          </div>
        </article>
      `;
    }
    if (source.type === "profile_report") {
      const profile = source.profile || {};
      const label = [profile.displayName, profile.username ? `@${profile.username}` : ""].filter(Boolean).join(" · ") || "Perfil indisponível";
      const profileHref = profile.id ? `./profile?id=${encodeURIComponent(profile.id)}` : "";
      return `
        <article class="admin-ticket-source-card">
          ${profileHref ? `<a class="admin-ticket-source-avatar" href="${profileHref}" target="_blank" rel="noopener">` : `<div class="admin-ticket-source-avatar">`}
            <img src="${escapeHtml(profile.avatarUrl || "./assets/avatar.svg")}" alt="">
          ${profileHref ? "</a>" : "</div>"}
          <div class="admin-ticket-source-body">
            <strong>${escapeHtml(source.label || "Perfil denunciado")}</strong>
            <p>${profileHref ? `<a class="admin-ticket-source-profile-link" href="${profileHref}" target="_blank" rel="noopener">${escapeHtml(label)}</a>` : escapeHtml(label)}</p>
            <dl>
              <div><dt>Motivo</dt><dd>${escapeHtml(source.reason || "Sem motivo informado.")}</dd></div>
              ${profile.id ? `<div><dt>Perfil</dt><dd><a href="./profile?id=${encodeURIComponent(profile.id)}" target="_blank" rel="noopener">Abrir perfil</a></dd></div>` : ""}
            </dl>
          </div>
        </article>
      `;
    }
    return "";
  }

  function renderTicketComposer(ticket) {
    if (ticket.status === "closed") {
      return `<p class="admin-ticket-locked">Caso encerrado. O usuário não pode responder nesta conversa.</p>`;
    }
    return `
      <section class="admin-ticket-reply-panel">
        <label>
          <span>Responder como Gimerr</span>
          <textarea rows="3" maxlength="2000" data-ticket-reply-body placeholder="Escreva uma resposta para o denunciante. Ao enviar, ele poderá continuar a conversa até que o caso seja encerrado."></textarea>
        </label>
        <div class="admin-ticket-reply-actions">
          <button class="primary-button" type="button" data-ticket-reply="${escapeHtml(ticket.id)}">Responder e liberar</button>
          <button class="text-button danger-button" type="button" data-ticket-close="${escapeHtml(ticket.id)}">Encerrar caso</button>
        </div>
        <p class="field-feedback${ticket.userCanReply ? " is-success" : ""}">
          ${ticket.userCanReply ? "O denunciante pode responder agora." : "O denunciante aguarda uma resposta ou liberação do admin."}
        </p>
      </section>
    `;
  }

  async function loadTickets() {
    setTicketFeedback("Carregando casos...");
    try {
      const token = await getAuthToken();
      const response = await fetch(`/api/admin-tickets?status=${encodeURIComponent(els.ticketFilter.value)}`, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar casos.");
      state.tickets = payload.tickets || [];
      state.ticketsLoaded = true;
      setTicketFeedback(`${state.tickets.length} caso(s) carregado(s).`, "success");
      renderTickets();
      loadAdminBadges();
    } catch (error) {
      setTicketFeedback(error.message || "Falha ao carregar casos.", "error");
      els.ticketList.innerHTML = "";
      els.ticketThread.innerHTML = `<div class="empty-state">Não foi possível carregar os casos.</div>`;
    }
  }

  async function loadTicketThread(ticketId) {
    state.selectedTicketId = ticketId;
    els.ticketList.querySelectorAll("[data-ticket-id]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.ticketId === ticketId);
    });
    els.ticketThread.innerHTML = `<div class="empty-state">Carregando conversa...</div>`;
    try {
      const token = await getAuthToken();
      const response = await fetch(`/api/admin-ticket-thread?ticketId=${encodeURIComponent(ticketId)}`, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar conversa.");
      const ticket = payload.ticket;
      els.ticketThread.innerHTML = `
        <header class="admin-ticket-thread-head">
          <div>
            <h2>${escapeHtml(ticket.title || "Caso Gimerr")}</h2>
            <p>Status: ${escapeHtml(ticketStatusLabel(ticket.status))}</p>
          </div>
          <span class="status-pill ${escapeHtml(ticket.status)}">${escapeHtml(ticketStatusLabel(ticket.status))}</span>
        </header>
        ${renderTicketSource(payload.source)}
        <div class="admin-ticket-message-list">
          ${(payload.messages || []).map(renderTicketMessage).join("") || `<div class="empty-state">Sem mensagens.</div>`}
        </div>
        ${renderTicketComposer(ticket)}
      `;
    } catch (error) {
      els.ticketThread.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "Falha ao carregar conversa.")}</div>`;
    }
  }

  async function replyTicket(ticketId) {
    const textarea = els.ticketThread.querySelector("[data-ticket-reply-body]");
    const body = textarea?.value?.trim() || "";
    if (!body) {
      textarea?.focus();
      setTicketFeedback("Escreva uma resposta para o usuário.", "error");
      return;
    }
    try {
      const token = await getAuthToken();
      const response = await fetch("/api/admin-ticket-reply", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ticketId, body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível responder caso.");
      setTicketFeedback("Resposta enviada.", "success");
      await loadTickets();
      await loadTicketThread(ticketId);
    } catch (error) {
      setTicketFeedback(error.message || "Falha ao responder caso.", "error");
    }
  }

  async function closeTicket(ticketId) {
    if (!window.confirm("Encerrar este caso? O usuário não poderá reabrir pela conversa atual.")) return;
    try {
      const token = await getAuthToken();
      const response = await fetch("/api/admin-ticket-action", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ticketId, action: "close" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível encerrar caso.");
      setTicketFeedback("Caso encerrado.", "success");
      await loadTickets();
      await loadTicketThread(ticketId);
    } catch (error) {
      setTicketFeedback(error.message || "Falha ao encerrar caso.", "error");
    }
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
      loadAdminBadges();
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
      if (state.ticketsLoaded) {
        await loadTickets();
        if (state.selectedTicketId && state.tickets.some((ticket) => ticket.id === state.selectedTicketId)) {
          await loadTicketThread(state.selectedTicketId);
        }
      }
    } catch (error) {
      setReportFeedback(error.message || "Falha ao aplicar moderação.", "error");
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function setAdminTab(tab) {
    els.tabs.forEach((button) => button.classList.toggle("is-active", button.dataset.adminTab === tab));
    els.panels.forEach((panel) => { panel.hidden = panel.dataset.adminPanel !== tab; });
    if (tab === "reports") loadReports();
    if (tab === "tickets") loadTickets();
  }

  async function loadAdminBadges() {
    if (state.badgesLoading) return;
    state.badgesLoading = true;
    try {
      const token = await getAuthToken();
      const headers = { accept: "application/json", authorization: `Bearer ${token}` };
      const [reportsRes, openTicketsRes, reopenedTicketsRes] = await Promise.all([
        fetch("/api/admin-post-reports?status=pending", { headers }),
        fetch("/api/admin-tickets?status=open", { headers }),
        fetch("/api/admin-tickets?status=reopened", { headers }),
      ]);
      const [reportsPayload, openTicketsPayload, reopenedTicketsPayload] = await Promise.all([
        reportsRes.json().catch(() => ({})),
        openTicketsRes.json().catch(() => ({})),
        reopenedTicketsRes.json().catch(() => ({})),
      ]);
      if (reportsRes.ok) setTabBadge(els.reportsBadge, reportsPayload.reports?.length || 0);
      if (openTicketsRes.ok || reopenedTicketsRes.ok) {
        setTabBadge(
          els.ticketsBadge,
          (openTicketsRes.ok ? openTicketsPayload.tickets?.length || 0 : 0)
            + (reopenedTicketsRes.ok ? reopenedTicketsPayload.tickets?.length || 0 : 0),
        );
      }
    } catch (error) {
      console.warn("Não foi possível carregar contadores do admin.", error);
    } finally {
      state.badgesLoading = false;
    }
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
      return `<p class="admin-taxonomy-empty">${escapeHtml(state.taxonomyError || "Lista da IGDB indisponível.")}</p>`;
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

    try {
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
      state.taxonomyError = "";
    } catch (error) {
      console.warn("Taxonomia IGDB indisponível no admin.", error);
      state.taxonomy.genres = [];
      state.taxonomy.platforms = [];
      state.taxonomyError = "Lista da IGDB indisponível neste ambiente.";
    } finally {
      state.taxonomyLoaded = true;
    }
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
    const note = card.querySelector("textarea")?.value?.trim() || "";
    if (action === "reject" && note.length < 3) {
      setFeedback("Informe o motivo da reprovação antes de rejeitar a solicitação.", "error");
      card.querySelector("textarea")?.focus();
      return;
    }
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
  els.ticketFilter.addEventListener("change", () => {
    state.selectedTicketId = "";
    loadTickets();
  });
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
  els.ticketList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-ticket-id]");
    if (!button) return;
    loadTicketThread(button.dataset.ticketId);
  });
  els.ticketThread.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-ticket-close]");
    if (closeButton) {
      closeTicket(closeButton.dataset.ticketClose);
      return;
    }
    const replyButton = event.target.closest("[data-ticket-reply]");
    if (replyButton) {
      replyTicket(replyButton.dataset.ticketReply);
    }
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
  loadAdminBadges();
})();
