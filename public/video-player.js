(function initGimerrVideoPlayer() {
  const FLUID_PLAYER_CDN = "https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js";
  let configPromise = null;
  let scriptPromise = null;
  let videoCounter = 0;
  let observer = null;

  function getConfig() {
    if (!configPromise) {
      configPromise = fetch("/api/video-ads-config", {
        headers: { accept: "application/json" },
      })
        .then((response) => response.ok ? response.json() : { enabled: false })
        .catch((error) => {
          console.warn("Não foi possível carregar configuração de anúncios em vídeo.", error);
          return { enabled: false };
        });
    }
    return configPromise;
  }

  function loadFluidPlayer() {
    if (window.fluidPlayer) return Promise.resolve(window.fluidPlayer);
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = FLUID_PLAYER_CDN;
      script.async = true;
      script.onload = () => {
        if (window.fluidPlayer) {
          resolve(window.fluidPlayer);
          return;
        }
        reject(new Error("Fluid Player não ficou disponível após carregar o script."));
      };
      script.onerror = () => reject(new Error("Não foi possível carregar o Fluid Player."));
      document.head.appendChild(script);
    });

    return scriptPromise;
  }

  function ensureVideoId(video) {
    if (video.id) return video.id;
    videoCounter += 1;
    video.id = `gimerr-fluid-video-${Date.now()}-${videoCounter}`;
    return video.id;
  }

  function ensureVideoSource(video) {
    const source = video.querySelector("source");
    if (source?.getAttribute("src")) return;

    const src = video.getAttribute("src") || video.currentSrc;
    if (!src) return;

    const nextSource = document.createElement("source");
    nextSource.src = src;
    nextSource.type = video.dataset.mediaType || "video/mp4";
    video.removeAttribute("src");
    video.appendChild(nextSource);
    video.load();
  }

  function getPlayerOptions(config, video) {
    const mainSource = video.querySelector("source")?.getAttribute("src") || video.getAttribute("src") || video.currentSrc || "";
    const mainType = video.querySelector("source")?.getAttribute("type") || "video/mp4";
    const restoreMainSource = () => {
      if (!mainSource) return;
      let source = video.querySelector("source");
      if (!source) {
        source = document.createElement("source");
        video.appendChild(source);
      }
      source.src = mainSource;
      source.type = mainType;
      video.src = mainSource;
    };
    const options = {
      layoutControls: {
        autoPlay: false,
        mute: false,
        allowTheatre: true,
        playPauseAnimation: true,
        playbackRateEnabled: true,
        allowDownload: false,
        playButtonShowing: true,
        fillToContainer: true,
        posterImage: video.getAttribute("poster") || "",
      },
    };

    if (config?.enabled && config.vastTag) {
      options.vastOptions = {
        adList: [{
          roll: config.roll || "preRoll",
          vastTag: config.vastTag,
        }],
        vastAdvanced: {
          noVastVideoCallback: restoreMainSource,
        },
      };
    }

    return options;
  }

  async function initializeVideo(video) {
    if (!video || video.dataset.fluidState === "ready" || video.dataset.fluidState === "loading") return;
    if (!video.isConnected) return;
    video.dataset.fluidState = "loading";

    const config = await getConfig();
    if (!video.isConnected) return;
    if (!config?.enabled) {
      video.dataset.fluidState = "native";
      return;
    }

    try {
      const fluidPlayer = await loadFluidPlayer();
      if (!video.isConnected) return;
      ensureVideoSource(video);
      const id = ensureVideoId(video);
      if (document.getElementById(id) !== video) return;
      const player = fluidPlayer(id, getPlayerOptions(config, video));
      video.addEventListener("error", () => {
        if (video.dataset.fluidFallbackRestored) return;
        video.dataset.fluidFallbackRestored = "true";
        const source = video.querySelector("source")?.getAttribute("src") || video.getAttribute("src") || video.currentSrc;
        if (!source) return;
        video.src = source;
        video.load();
      });
      video.dataset.fluidState = "ready";
      video.gimerrFluidPlayer = player;
    } catch (error) {
      if (!video.isConnected) return;
      video.dataset.fluidState = "failed";
      console.warn("Não foi possível inicializar Fluid Player.", error);
    }
  }

  function getObserver() {
    if (!("IntersectionObserver" in window)) return null;
    if (observer) return observer;
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        initializeVideo(entry.target);
      });
    }, {
      rootMargin: "360px 0px",
      threshold: 0.01,
    });
    return observer;
  }

  function bindLazyInitialization(video) {
    if (!video || video.dataset.fluidBound) return;
    video.dataset.fluidBound = "true";
    video.addEventListener("pointerdown", () => initializeVideo(video), { once: true });
    video.addEventListener("focus", () => initializeVideo(video), { once: true });
    const lazyObserver = getObserver();
    if (lazyObserver) {
      lazyObserver.observe(video);
    } else {
      window.setTimeout(() => initializeVideo(video), 0);
    }
  }

  function prepare(root = document) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    const videos = [...scope.querySelectorAll("video[data-fluid-video]")];
    videos.forEach(bindLazyInitialization);
    getConfig().then((config) => {
      if (config?.enabled) {
        loadFluidPlayer().catch((error) => {
          console.warn("Não foi possível pré-carregar Fluid Player.", error);
        });
      }
    });
  }

  window.GimerrVideoPlayer = {
    prepare,
    initializeVideo,
  };

  document.addEventListener("pointerdown", (event) => {
    const video = event.target instanceof Element ? event.target.closest("video[data-fluid-video]") : null;
    if (video) initializeVideo(video);
  }, { capture: true });

  document.addEventListener("focusin", (event) => {
    const video = event.target instanceof Element ? event.target.closest("video[data-fluid-video]") : null;
    if (video) initializeVideo(video);
  });

  document.addEventListener("DOMContentLoaded", () => prepare(document));
})();
