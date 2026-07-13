(function initGimerrExoclickAds() {
  const AD_PROVIDER_SRC = "https://a.magsrv.com/ad-provider.js";
  const BANNER_ZONE_ID = "5972734";
  const BANNER_CLASS = "eas6a97888e20";
  let adProviderPromise = null;

  function loadAdProvider() {
    if (window.AdProvider && document.querySelector(`script[src="${AD_PROVIDER_SRC}"]`)) {
      return Promise.resolve(window.AdProvider);
    }
    if (adProviderPromise) return adProviderPromise;

    adProviderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${AD_PROVIDER_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(window.AdProvider), { once: true });
        existing.addEventListener("error", () => reject(new Error("Não foi possível carregar o provedor de anúncios.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = AD_PROVIDER_SRC;
      script.async = true;
      script.type = "application/javascript";
      script.onload = () => resolve(window.AdProvider);
      script.onerror = () => reject(new Error("Não foi possível carregar o provedor de anúncios."));
      document.head.appendChild(script);
    });

    return adProviderPromise;
  }

  function slotHasNoFillMessage(slot) {
    return /no ads to display|placement #\d+/i.test(slot.textContent || "");
  }

  function slotLooksFilled(slot) {
    if (!slot || slotHasNoFillMessage(slot)) return false;
    if (slot.querySelector("iframe, img, video, canvas")) return true;
    const rect = slot.getBoundingClientRect();
    return rect.height > 80 && rect.width > 120 && (slot.textContent || "").trim().length > 0;
  }

  function setFallback(panel, slot, fallback, useFallback) {
    panel.classList.toggle("has-external-ad", !useFallback);
    slot.hidden = useFallback;
    slot.classList.toggle("is-filled", !useFallback);
    slot.classList.toggle("is-loading", false);
    if (fallback) fallback.hidden = !useFallback;
  }

  function checkAdState(panel, slot, fallback) {
    setFallback(panel, slot, fallback, !slotLooksFilled(slot));
  }

  async function mountIndexRail() {
    const panel = document.querySelector("[data-exoclick-rail]");
    if (!panel || panel.dataset.adMounted === "true") return;

    const slot = panel.querySelector("#index-ad-provider-slot");
    const fallback = panel.querySelector("#index-ad-fallback-grid");
    if (!slot) return;

    panel.dataset.adMounted = "true";
    slot.hidden = false;
    slot.classList.add("is-loading");
    slot.replaceChildren();

    const placement = document.createElement("ins");
    placement.className = BANNER_CLASS;
    placement.dataset.zoneid = BANNER_ZONE_ID;
    slot.appendChild(placement);

    try {
      window.AdProvider = window.AdProvider || [];
      await loadAdProvider();
      window.AdProvider = window.AdProvider || [];
      window.AdProvider.push({ serve: {} });
      window.setTimeout(() => checkAdState(panel, slot, fallback), 3200);
      window.setTimeout(() => checkAdState(panel, slot, fallback), 7000);
    } catch (error) {
      console.warn("Publicidade externa indisponível. Usando fallback Gimerr.", error);
      setFallback(panel, slot, fallback, true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountIndexRail, { once: true });
  } else {
    mountIndexRail();
  }
})();
