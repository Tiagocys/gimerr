(function initGimerrVideoPlayer() {
  const FLUID_PLAYER_CDN = "https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js";
  let configPromise = null;
  let scriptPromise = null;
  let videoCounter = 0;
  let viewerToken = "";

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

  function formatVideoViewCount(value) {
    const count = Number(value || 0);
    const formatted = new Intl.NumberFormat("pt-BR").format(count);
    return count === 1 ? "1 visualização" : `${formatted} visualizações`;
  }

  function getViewerToken() {
    if (viewerToken) return viewerToken;
    const key = "gimerr-video-viewer-token";
    viewerToken = localStorage.getItem(key) || "";
    if (!viewerToken) {
      viewerToken = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, viewerToken);
    }
    return viewerToken;
  }

  function updateVideoViewCount(postId, count) {
    document.querySelectorAll("[data-video-view-count]").forEach((element) => {
      if (element.dataset.postId !== postId) return;
      element.textContent = formatVideoViewCount(count);
    });
    document.dispatchEvent(new CustomEvent("gimerr:video-view", {
      detail: {
        postId,
        videoViewCount: Number(count || 0),
      },
    }));
  }

  async function getAuthHeader() {
    if (!window.GimerrAuth?.getSession) return {};
    const { data } = await window.GimerrAuth.getSession().catch(() => ({ data: null }));
    return data?.session?.access_token
      ? { authorization: `Bearer ${data.session.access_token}` }
      : {};
  }

  function getVastTagForRequest(vastTag) {
    if (!vastTag) return "";
    try {
      const url = new URL(vastTag, window.location.origin);
      const legacyZoneId = url.searchParams.get("idz");
      if (legacyZoneId && !url.searchParams.has("idzone")) {
        url.searchParams.set("idzone", legacyZoneId);
        url.searchParams.delete("idz");
      }
      url.searchParams.set("cb", `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      return url.toString();
    } catch {
      return vastTag;
    }
  }

  async function recordVideoView(target) {
    const postId = target?.dataset?.videoPostId || target?.closest?.("[data-video-post-id]")?.dataset?.videoPostId || "";
    if (!postId || target.dataset.videoViewRecorded === "true") return;
    target.dataset.videoViewRecorded = "true";

    try {
      const response = await fetch("/api/posts/video-view", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(await getAuthHeader()),
        },
        body: JSON.stringify({
          postId,
          viewerToken: getViewerToken(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível registrar visualização.");
      updateVideoViewCount(postId, payload.videoViewCount);
    } catch (error) {
      console.warn("Não foi possível registrar visualização do vídeo.", error);
    }
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
          vastTag: getVastTagForRequest(config.vastTag),
          timer: 5,
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
        if (!video.querySelector("source")) {
          const nextSource = document.createElement("source");
          nextSource.src = source;
          nextSource.type = video.dataset.mediaType || "video/mp4";
          video.appendChild(nextSource);
        }
      });
      video.dataset.fluidState = "ready";
      video.gimerrFluidPlayer = player;
    } catch (error) {
      if (!video.isConnected) return;
      video.dataset.fluidState = "failed";
      console.warn("Não foi possível inicializar Fluid Player.", error);
    }
  }

  function bindLazyInitialization(video) {
    if (!video || video.dataset.fluidBound) return;
    video.dataset.fluidBound = "true";
    video.addEventListener("pointerdown", () => initializeVideo(video), { once: true });
    video.addEventListener("focus", () => initializeVideo(video), { once: true });
  }

  function prepare(root = document) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    const videos = [...scope.querySelectorAll("video[data-fluid-video]")];
    videos.forEach(bindLazyInitialization);
    if (!videos.length) return;
    getConfig().then((config) => {
      if (config?.enabled) {
        loadFluidPlayer().catch((error) => {
          console.warn("Não foi possível pré-carregar Fluid Player.", error);
        });
      }
    });
  }

  async function loadVideoFromPoster(button) {
    if (!button || button.dataset.loadingVideo === "true") return;
    const src = button.dataset.videoSrc || "";
    if (!src) return;
    button.dataset.loadingVideo = "true";
    button.setAttribute("aria-busy", "true");

    const video = document.createElement("video");
    video.className = "media-frame";
    video.dataset.fluidVideo = "true";
    video.dataset.mediaType = button.dataset.videoType || "video/mp4";
    video.dataset.videoPostId = button.dataset.videoPostId || "";
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    if (button.dataset.videoPoster) video.poster = button.dataset.videoPoster;

    const source = document.createElement("source");
    source.src = src;
    source.type = button.dataset.videoType || "video/mp4";
    video.appendChild(source);

    button.replaceWith(video);
    recordVideoView(video);
    await initializeVideo(video);
    video.play().catch(() => {});
  }

  window.GimerrVideoPlayer = {
    prepare,
    initializeVideo,
    loadVideoFromPoster,
  };

  document.addEventListener("pointerdown", (event) => {
    const posterButton = event.target instanceof Element ? event.target.closest("[data-video-src]") : null;
    if (posterButton) {
      loadVideoFromPoster(posterButton);
      return;
    }
    const video = event.target instanceof Element ? event.target.closest("video[data-fluid-video]") : null;
    if (video) {
      recordVideoView(video);
      initializeVideo(video);
    }
  }, { capture: true });

  document.addEventListener("click", (event) => {
    const posterButton = event.target instanceof Element ? event.target.closest("[data-video-src]") : null;
    if (posterButton) loadVideoFromPoster(posterButton);
  });

  document.addEventListener("focusin", (event) => {
    const video = event.target instanceof Element ? event.target.closest("video[data-fluid-video]") : null;
    if (video) {
      recordVideoView(video);
      initializeVideo(video);
    }
  });

  document.addEventListener("DOMContentLoaded", () => prepare(document));
})();
