(function initGimerrAdcashAds() {
  const ADCASH_SRC = "https://acscdn.com/script/aclib.js";
  const ADCASH_ZONE_ID = "11701982";
  let adcashPromise = null;
  let activeRailContext = null;

  function isAdcashError(event) {
    const filename = String(event?.filename || "");
    const message = String(event?.message || event?.reason?.message || event?.reason || "");
    const stack = String(event?.error?.stack || event?.reason?.stack || "");
    return filename.includes("aclib.js")
      || stack.includes("aclib.js")
      || /aclib|adcash|runBanner/i.test(message);
  }

  function loadAdcash() {
    if (window.aclib?.runBanner) return Promise.resolve(window.aclib);
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

  function slotHasNoFillMessage(slot) {
    return /no ads to display|placement #\d+|no fill|sem anúncios/i.test(slot.textContent || "");
  }

  function slotLooksFilled(slot) {
    if (!slot || slotHasNoFillMessage(slot)) return false;
    if (slot.querySelector("iframe, img, video, canvas")) return true;
    const rect = slot.getBoundingClientRect();
    return rect.height > 80 && rect.width > 120 && (slot.textContent || "").trim().length > 0;
  }

  function setState(panel, slot, fallback, state) {
    activeRailContext = state === "loading" ? { panel, slot, fallback } : activeRailContext;
    panel.dataset.adState = state;
    panel.classList.toggle("has-external-ad", state === "filled");
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

  async function mountIndexRail() {
    const panel = document.querySelector("[data-adcash-rail]");
    if (!panel || panel.dataset.adMounted === "true") return;

    const slot = panel.querySelector("#index-ad-provider-slot");
    const fallback = panel.querySelector("#index-ad-fallback-grid");
    if (!slot) return;

    panel.dataset.adMounted = "true";
    setState(panel, slot, fallback, "loading");
    slot.replaceChildren();

    try {
      await loadAdcash();
      if (!window.aclib?.runBanner) {
        throw new Error("Biblioteca AdCash indisponível após carregamento.");
      }

      const runner = document.createElement("script");
      runner.type = "text/javascript";
      runner.text = `
        try {
          aclib.runBanner({ zoneId: '${ADCASH_ZONE_ID}' });
        } catch (error) {
          window.dispatchEvent(new CustomEvent("gimerr:adcash-error", {
            detail: { message: error && error.message ? error.message : String(error || "AdCash error") }
          }));
        }
      `;
      slot.appendChild(runner);

      const filled = await waitForSlotFill(slot);
      setState(panel, slot, fallback, filled ? "filled" : "fallback");
    } catch (error) {
      console.warn("Publicidade AdCash indisponível. Usando fallback Gimerr.", error);
      setState(panel, slot, fallback, "fallback");
    }
  }

  window.addEventListener("gimerr:adcash-error", (event) => {
    if (!activeRailContext) return;
    console.warn("Publicidade AdCash indisponível. Usando fallback Gimerr.", event.detail?.message || event.detail || event);
    setState(activeRailContext.panel, activeRailContext.slot, activeRailContext.fallback, "fallback");
  });

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountIndexRail, { once: true });
  } else {
    mountIndexRail();
  }
})();
