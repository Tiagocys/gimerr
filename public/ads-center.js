(function initAdsCenter() {
  function blockAdsCenterAccess(message = "A Central de Ads está em desenvolvimento e será liberada em breve.") {
    const modal = document.querySelector("#ads-placement-modal");
    const main = document.querySelector(".ads-center-layout");
    if (modal) modal.hidden = true;
    if (!main) return;
    main.innerHTML = `
      <section class="ads-center-head">
        <div>
          <span class="ads-center-kicker">Gimerr Ads</span>
          <h1>Central de Ads</h1>
          <p>${message}</p>
        </div>
        <div class="ads-center-head-actions">
          <a class="text-button" href="./">Voltar ao feed</a>
        </div>
      </section>
    `;
  }

  const config = {
    feed: {
      badge: "Feed",
      title: "Anúncios do feed",
      copy: "Campanhas nativas para aparecer entre posts ou em vídeos publicados por outros usuários.",
      creative: "Imagem ou vídeo, texto curto, link de destino e prévia no formato do feed.",
      placement: "Feed principal, blocos misturados aos posts e futuras inserções em vídeos.",
      next: "Envie uma imagem ou vídeo e informe o link de destino da campanha.",
      accept: "image/*,video/*",
      helper: "Use imagem ou vídeo. O criativo será adaptado aos espaços do feed.",
    },
    "index-grid": {
      badge: "Index",
      title: "Grade de anúncios do index",
      copy: "Campanhas de imagem para ocupar a grade lateral exibida ao lado do feed na página inicial.",
      creative: "Imagem 16:9, link de destino e texto curto para identificação interna.",
      placement: "Grade lateral do index, apenas para desktop.",
      next: "Envie uma imagem 16:9 e informe o link de destino da campanha.",
      accept: "image/*",
      helper: "Este posicionamento aceita apenas imagem, preferencialmente em 16:9.",
    },
    "game-pages": {
      badge: "Games",
      title: "Página de games",
      copy: "Campanhas direcionadas para feeds de games específicos.",
      creative: "Imagem ou vídeo conforme o espaço escolhido, link de destino e prévia por game.",
      placement: "Feed das páginas de games selecionados pelo anunciante.",
      next: "Envie o criativo e informe o link de destino. A escolha dos games virá na próxima etapa.",
      accept: "image/*,video/*",
      helper: "Use imagem ou vídeo. Depois vamos escolher os games onde a campanha poderá aparecer.",
    },
    marketplace: {
      badge: "Marketplace",
      title: "Marketplace",
      copy: "Campanhas em formato de imagem para aparecer junto aos anúncios da comunidade.",
      creative: "Imagem do anúncio, link de destino, título curto e prévia no padrão do marketplace.",
      placement: "Áreas de marketplace e blocos de anúncios de comunidade.",
      next: "Envie uma imagem e informe o link de destino do anúncio.",
      accept: "image/*",
      helper: "Este posicionamento aceita imagem para manter o padrão visual do marketplace.",
    },
    "all-in-one": {
      badge: "All-in-one",
      title: "All-in-one",
      copy: "Campanhas em que o Gimerr distribui o anúncio nos espaços mais adequados conforme formato, orçamento e disponibilidade.",
      creative: "Imagem ou vídeo, link de destino e variações necessárias para encaixar a campanha em diferentes áreas.",
      placement: "Feed, páginas de games, marketplace e grade lateral quando o criativo for compatível.",
      next: "Envie o criativo e informe o link de destino. O Gimerr vai sugerir os melhores espaços depois.",
      accept: "image/*,video/*",
      helper: "Use imagem ou vídeo. Criativos compatíveis com mais espaços terão mais opções de entrega.",
    },
  };

  const els = {
    modal: document.querySelector("#ads-placement-modal"),
    changePlacement: document.querySelector("#change-ad-placement"),
    empty: document.querySelector("#ads-center-empty"),
    config: document.querySelector("#ads-center-config"),
    badge: document.querySelector("#ads-selected-badge"),
    title: document.querySelector("#ads-selected-title"),
    copy: document.querySelector("#ads-selected-copy"),
    creative: document.querySelector("#ads-creative-scope"),
    placement: document.querySelector("#ads-placement-scope"),
    next: document.querySelector("#ads-next-step"),
    uploadHelper: document.querySelector("#ads-creative-upload-helper"),
    creativeFile: document.querySelector("#ads-creative-file"),
    preview: document.querySelector("#ads-creative-preview"),
    creativeForm: document.querySelector("#ads-creative-form"),
    campaignName: document.querySelector("#ads-campaign-name"),
    destinationUrl: document.querySelector("#ads-destination-url"),
    feedback: document.querySelector("#ads-creative-feedback"),
    placementButtons: document.querySelectorAll("[data-ad-placement]"),
  };

  let selectedPlacement = "";

  function setFeedback(message, tone = "") {
    if (!els.feedback) return;
    els.feedback.textContent = message || "";
    els.feedback.className = `field-feedback${tone ? ` is-${tone}` : ""}`;
  }

  function formatFileSize(size) {
    const bytes = Number(size || 0);
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  }

  function clearPreview() {
    if (!els.preview) return;
    els.preview.hidden = true;
    els.preview.innerHTML = "";
  }

  function renderPreview(file) {
    if (!els.preview) return;
    clearPreview();
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const url = isImage || isVideo ? URL.createObjectURL(file) : "";
    const media = isImage
      ? `<img src="${url}" alt="">`
      : isVideo
        ? `<video src="${url}" muted playsinline preload="metadata"></video>`
        : "";

    els.preview.innerHTML = `
      ${media}
      <div>
        <strong>${file.name}</strong>
        <span>${file.type || "Arquivo"} · ${formatFileSize(file.size)}</span>
      </div>
    `;
    els.preview.hidden = false;
  }

  function openPlacementModal() {
    els.modal.hidden = false;
  }

  function closePlacementModal() {
    els.modal.hidden = true;
  }

  function selectPlacement(placement) {
    const nextConfig = config[placement];
    if (!nextConfig) return;

    selectedPlacement = placement;
    els.empty.hidden = true;
    els.config.hidden = false;
    els.badge.textContent = nextConfig.badge;
    els.title.textContent = nextConfig.title;
    els.copy.textContent = nextConfig.copy;
    els.creative.textContent = nextConfig.creative;
    els.placement.textContent = nextConfig.placement;
    els.next.textContent = nextConfig.next;
    els.uploadHelper.textContent = nextConfig.helper;
    els.creativeFile.accept = nextConfig.accept;
    els.creativeFile.value = "";
    els.campaignName.value = "";
    els.destinationUrl.value = "";
    clearPreview();
    setFeedback("");
    closePlacementModal();
  }

  async function requireAdminAccess() {
    if (!window.GimerrAuth?.getSession) {
      window.location.replace("./sign-in.html");
      return false;
    }

    const client = await window.GimerrAuth.getClient();
    const { data } = await window.GimerrAuth.getSession().catch(() => ({ data: null }));
    if (!data?.session?.user) {
      window.location.replace("./sign-in.html");
      return false;
    }

    const { data: profile, error } = await client
      .from("profiles")
      .select("is_admin")
      .eq("id", data.session.user.id)
      .maybeSingle();

    if (error || Number(profile?.is_admin || 0) !== 1) {
      blockAdsCenterAccess("Acesso restrito a administradores.");
      return false;
    }

    return true;
  }

  els.changePlacement?.addEventListener("click", openPlacementModal);
  els.placementButtons.forEach((button) => {
    button.addEventListener("click", () => selectPlacement(button.dataset.adPlacement));
  });
  els.creativeFile?.addEventListener("change", () => {
    const file = els.creativeFile.files?.[0] || null;
    renderPreview(file);
    setFeedback(file ? "Criativo selecionado. Informe o link de destino para continuar." : "");
  });
  els.creativeForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const file = els.creativeFile.files?.[0] || null;
    const destination = els.destinationUrl.value.trim();
    const placementConfig = config[selectedPlacement];

    if (!selectedPlacement || !placementConfig) {
      setFeedback("Escolha um posicionamento antes de continuar.", "warning");
      openPlacementModal();
      return;
    }
    if (!file) {
      setFeedback("Envie o criativo do anúncio para continuar.", "warning");
      return;
    }
    if (!destination) {
      setFeedback("Informe o link de destino do anúncio.", "warning");
      els.destinationUrl.focus();
      return;
    }

    try {
      new URL(destination);
    } catch {
      setFeedback("Informe um link de destino válido, começando com https://.", "warning");
      els.destinationUrl.focus();
      return;
    }

    setFeedback("Criativo e destino prontos. A próxima etapa será orçamento e pagamento com Stripe.", "success");
  });

  async function init() {
    const canAccess = await requireAdminAccess();
    if (!canAccess) return;
    openPlacementModal();
  }

  init();
})();
