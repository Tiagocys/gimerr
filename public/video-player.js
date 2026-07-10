(function initGimerrVideoPlayer() {
  const FLUID_PLAYER_CDN = "https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js";
  let configPromise = null;
  let scriptPromise = null;
  let videoCounter = 0;

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

  function getPlayerOptions(config, video) {
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
      };
    }

    return options;
  }

  async function initializeVideo(video) {
    if (!video || video.dataset.fluidState === "ready" || video.dataset.fluidState === "loading") return;
    video.dataset.fluidState = "loading";

    const config = await getConfig();
    if (!config?.enabled) {
      video.dataset.fluidState = "native";
      return;
    }

    try {
      const fluidPlayer = await loadFluidPlayer();
      const id = ensureVideoId(video);
      const player = fluidPlayer(id, getPlayerOptions(config, video));
      video.dataset.fluidState = "ready";
      video.gimerrFluidPlayer = player;
    } catch (error) {
      video.dataset.fluidState = "failed";
      console.warn("Não foi possível inicializar Fluid Player.", error);
    }
  }

  function bindLazyInitialization(video) {
    if (!video || video.dataset.fluidBound) return;
    video.dataset.fluidBound = "true";

    const start = () => {
      initializeVideo(video);
    };

    video.addEventListener("pointerdown", start, { once: true });
    video.addEventListener("touchstart", start, { once: true, passive: true });
    video.addEventListener("focus", start, { once: true });
    video.addEventListener("play", start, { once: true });
  }

  function prepare(root = document) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    scope.querySelectorAll("video[data-fluid-video]").forEach(bindLazyInitialization);
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

  document.addEventListener("DOMContentLoaded", () => prepare(document));
})();
