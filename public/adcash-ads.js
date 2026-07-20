(function initGimerrAdcashAds() {
  const ADCASH_SRC = "https://acscdn.com/script/aclib.js";
  const DEFAULT_ADCASH_MARKETPLACE_ZONE_ID = "11767214";
  let adcashPromise = null;
  let adsConfigPromise = null;
  const activeInlineContexts = new Set();
  let inlineAdCounter = 0;

  function hasAdcashRunner() {
    return Boolean(window.aclib?.runBanner);
  }

  function isAdcashError(event) {
    const filename = String(event?.filename || "");
    const message = String(event?.message || event?.reason?.message || event?.reason || "");
    const stack = String(event?.error?.stack || event?.reason?.stack || "");
    return filename.includes("aclib.js")
      || stack.includes("aclib.js")
      || /aclib|adcash|runBanner/i.test(message);
  }

  function loadAdcash() {
    if (hasAdcashRunner()) return Promise.resolve(window.aclib);
    if (adcashPromise) return adcashPromise;

    adcashPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${ADCASH_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(window.aclib), { once: true });
        existing.addEventListener("error", () => reject(new Error("Não foi possível carregar a biblioteca AdCash.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.id = "aclib";
      script.src = ADCASH_SRC;
      script.type = "text/javascript";
      script.onload = () => resolve(window.aclib);
      script.onerror = () => reject(new Error("Não foi possível carregar a biblioteca AdCash."));
      document.head.appendChild(script);
    });

    return adcashPromise;
  }

  function getAdsConfig() {
    if (adsConfigPromise) return adsConfigPromise;
    adsConfigPromise = fetch("/api/ads-config", {
      headers: { accept: "application/json" },
    })
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({}));
    return adsConfigPromise;
  }

  function slotHasNoFillMessage(slot) {
    return /no ads to display|placement #\d+|no fill|sem anúncios/i.test(slot.textContent || "");
  }

  function slotLooksFilled(slot) {
    if (!slot || slotHasNoFillMessage(slot)) return false;
    return Boolean(slot.querySelector("iframe, img, video, canvas, object, embed"));
  }

  function setInlineState(card, slot, fallback, state) {
    const context = { card, slot, fallback };
    if (state === "loading") {
      activeInlineContexts.add(context);
    } else {
      [...activeInlineContexts].forEach((item) => {
        if (item.card === card) activeInlineContexts.delete(item);
      });
    }
    card.dataset.adState = state;
    card.classList.toggle("has-external-ad", state === "filled");
    slot.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    slot.hidden = state === "fallback";
    slot.classList.toggle("is-filled", state === "filled");
    slot.classList.toggle("is-loading", state === "loading");
    if (fallback) fallback.hidden = state !== "fallback";
  }

  function waitForSlotFill(slot, timeoutMs = 6200) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (slotLooksFilled(slot)) {
          window.clearInterval(timer);
          resolve(true);
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 400);
    });
  }

  function renderMarketplaceAdCard() {
    inlineAdCounter += 1;
    const slotId = `marketplace-ad-provider-slot-${Date.now()}-${inlineAdCounter}`;
    return `
      <article class="post-card marketplace-post-card marketplace-ad-card" data-adcash-marketplace-card>
        <div class="marketplace-ad-frame">
          <div class="ad-provider-slot marketplace-ad-provider-slot is-loading" id="${slotId}" data-adcash-marketplace-slot aria-label="Publicidade AdCash" aria-busy="true">
            <span class="ad-loader-line ad-loader-line-wide"></span>
            <span class="ad-loader-line"></span>
          </div>
          <a class="listing-placeholder-card marketplace-ad-fallback" data-adcash-marketplace-fallback href="./ads-center.html" aria-disabled="true" hidden>
            <span class="listing-placeholder-title">Anuncie no Gimerr</span>
          </a>
        </div>
        <div class="post-body">
          <div>
            <p class="post-text">Publicidade</p>
          </div>
          <span class="channel-line">
            <span class="channel-game-logo" aria-hidden="true">
              <img src="./assets/logo-square.svg" alt="">
            </span>
            <span>Gimerr Ads</span>
          </span>
          <div class="post-action-bar post-action-bar--listing listing-card-meta">
            <span>Patrocinado</span>
          </div>
        </div>
      </article>
    `;
  }

  async function mountMarketplaceAdSlot(slot) {
    if (!slot || slot.dataset.adMounted === "true") return;
    const card = slot.closest("[data-adcash-marketplace-card]");
    const fallback = card?.querySelector("[data-adcash-marketplace-fallback]");
    if (!card) return;

    slot.dataset.adMounted = "true";
    setInlineState(card, slot, fallback, "loading");
    slot.replaceChildren();

    try {
      const [config] = await Promise.all([
        getAdsConfig(),
        loadAdcash(),
      ]);
      const zoneId = String(config?.banner?.marketplaceZoneId || DEFAULT_ADCASH_MARKETPLACE_ZONE_ID).trim();
      if (!zoneId || !hasAdcashRunner()) {
        throw new Error("Biblioteca AdCash indisponível após carregamento.");
      }

      const runner = document.createElement("script");
      runner.type = "text/javascript";
      runner.text = `
        try {
          if (aclib.runBanner) {
            aclib.runBanner({ zoneId: ${JSON.stringify(zoneId)} });
          } else {
            throw new Error("AdCash runner indisponível.");
          }
        } catch (error) {
          window.dispatchEvent(new CustomEvent("gimerr:adcash-error", {
            detail: { message: error && error.message ? error.message : String(error || "AdCash error") }
          }));
        }
      `;
      slot.appendChild(runner);

      const filled = await waitForSlotFill(slot);
      setInlineState(card, slot, fallback, filled ? "filled" : "fallback");
    } catch (error) {
      console.warn("Publicidade AdCash indisponível. Usando fallback Gimerr.", error);
      setInlineState(card, slot, fallback, "fallback");
    }
  }

  function prepareMarketplaceAds(root = document) {
    root.querySelectorAll("[data-adcash-marketplace-slot]").forEach((slot) => {
      mountMarketplaceAdSlot(slot);
    });
  }

  window.addEventListener("gimerr:adcash-error", (event) => {
    if (!activeInlineContexts.size) return;
    console.warn("Publicidade AdCash indisponível. Usando fallback Gimerr.", event.detail?.message || event.detail || event);
    [...activeInlineContexts].forEach((context) => {
      setInlineState(context.card, context.slot, context.fallback, "fallback");
    });
  });

  window.GimerrAdcashAds = {
    renderMarketplaceAdCard,
    prepareMarketplaceAds,
  };

  window.addEventListener("error", (event) => {
    if (!isAdcashError(event)) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("gimerr:adcash-error", {
      detail: { message: event.message || "Erro interno do AdCash." },
    }));
  }, true);

  window.addEventListener("unhandledrejection", (event) => {
    if (!isAdcashError(event)) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("gimerr:adcash-error", {
      detail: { message: event.reason?.message || event.reason || "Falha interna do AdCash." },
    }));
  });

})();
