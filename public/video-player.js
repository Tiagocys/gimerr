(function initGimerrVideoPlayer() {
  const FLUID_PLAYER_SRC = "https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js";
  let fluidPlayerPromise = null;
  let fluidPlayerCounter = 0;
  let viewerToken = "";

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

  function loadFluidPlayer() {
    if (window.fluidPlayer) return Promise.resolve(window.fluidPlayer);
    if (fluidPlayerPromise) return fluidPlayerPromise;

    fluidPlayerPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${FLUID_PLAYER_SRC}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(window.fluidPlayer), { once: true });
        existing.addEventListener("error", () => reject(new Error("Não foi possível carregar o player de vídeo.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = FLUID_PLAYER_SRC;
      script.async = true;
      script.onload = () => resolve(window.fluidPlayer);
      script.onerror = () => reject(new Error("Não foi possível carregar o player de vídeo."));
      document.head.appendChild(script);
    });

    return fluidPlayerPromise;
  }

  function getFluidOptions() {
    return {
      layoutControls: {
        fillToContainer: true,
        primaryColor: "#111827",
        playButtonShowing: true,
        playPauseAnimation: true,
        posterImageSize: "contain",
      },
    };
  }

  function prewarmVideoPlayer() {
    loadFluidPlayer().catch(() => {});
  }

  async function initializeFluidVideo(video) {
    if (!video) return null;
    if (video._gimerrFluidPlayer) return video._gimerrFluidPlayer;
    if (video.dataset.fluidPlayerState === "loading") return null;
    video.dataset.fluidPlayerState = "loading";

    if (!video.id) {
      fluidPlayerCounter += 1;
      video.id = `gimerr-fluid-video-${Date.now()}-${fluidPlayerCounter}`;
    }

    try {
      const fluidPlayer = await loadFluidPlayer();
      if (!fluidPlayer || !video.isConnected) return;
      video._gimerrFluidPlayer = fluidPlayer(video, getFluidOptions());
      video.dataset.fluidPlayerState = "ready";
      return video._gimerrFluidPlayer;
    } catch (error) {
      video.dataset.fluidPlayerState = "fallback";
      video.controls = true;
      console.warn("Fluid Player indisponível. Usando player nativo.", error);
      return null;
    }
  }

  async function initializeVideo(video) {
    if (!video) return null;
    if (video.dataset.videoState === "ready") return video._gimerrFluidPlayer || null;
    if (!video.isConnected) return;
    ensureVideoSource(video);
    video.dataset.videoState = "ready";
    return initializeFluidVideo(video);
  }

  function startVideoPlayback(video, player) {
    if (!video?.isConnected) return;
    const fluidPlayer = player || video._gimerrFluidPlayer;
    if (fluidPlayer && typeof fluidPlayer.play === "function") {
      try {
        const result = fluidPlayer.play();
        if (result?.catch) result.catch(() => {});
        return;
      } catch {}
    }
    try {
      const result = video.play();
      if (result?.catch) result.catch(() => {});
    } catch {}
  }

  function bindLazyInitialization(video) {
    if (!video || video.dataset.videoBound) return;
    video.dataset.videoBound = "true";
    video.addEventListener("pointerdown", () => initializeVideo(video), { once: true });
    video.addEventListener("focus", () => initializeVideo(video), { once: true });
  }

  function prepare(root = document) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    scope.querySelectorAll("video[data-fluid-video]").forEach(bindLazyInitialization);
    if (scope.querySelector("[data-video-src]")) {
      window.setTimeout(prewarmVideoPlayer, 0);
    }
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
    const player = await initializeVideo(video);
    startVideoPlayback(video, player);
  }

  function stopVideo(video) {
    if (!video) return;
    try {
      video.pause();
      video.currentTime = 0;
    } catch {}

    const player = video._gimerrFluidPlayer;
    if (!player) return;
    try {
      if (typeof player.pause === "function") player.pause();
      if (typeof player.destroy === "function") player.destroy();
      if (typeof player.destruct === "function") player.destruct();
      if (typeof player.dispose === "function") player.dispose();
    } catch {}
    delete video._gimerrFluidPlayer;
    delete video.dataset.fluidPlayerState;
  }

  function stopAll(root = document) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    scope.querySelectorAll("video[data-fluid-video]").forEach(stopVideo);
  }

  window.GimerrVideoPlayer = {
    prepare,
    initializeVideo,
    loadVideoFromPoster,
    stopAll,
  };

  document.addEventListener("pointerdown", (event) => {
    const posterButton = event.target instanceof Element ? event.target.closest("[data-video-src]") : null;
    if (posterButton) {
      event.preventDefault();
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
    if (posterButton) {
      event.preventDefault();
      loadVideoFromPoster(posterButton);
    }
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
