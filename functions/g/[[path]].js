const GAME_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#111827">
  <base href="/">
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <title>Jogo | Gimerr</title>
  <link rel="stylesheet" href="/styles.css?v=20260722-share-title-no-p">
</head>
<body>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Gimerr">
        <img class="brand-logo" src="/assets/logo.svg" alt="Gimerr">
      </a>

      <div class="search-box">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M10.8 18.1a7.3 7.3 0 1 1 5.1-2.1l4 4-1.4 1.4-4-4a7.3 7.3 0 0 1-3.7 1Zm0-2a5.3 5.3 0 1 0 0-10.6 5.3 5.3 0 0 0 0 10.6Z"/>
        </svg>
        <input id="game-search" type="search" placeholder="Buscar jogos e usuários" aria-label="Buscar jogos e usuários">
      </div>

      <nav class="top-actions" aria-label="Ações principais">
        <a class="auth-button" href="/sign-in.html" hidden>Entrar</a>
        <div class="account-menu" data-account-menu hidden></div>
      </nav>
    </header>

    <main class="game-layout is-loading" id="game-layout">
      <section class="game-hero" aria-labelledby="game-title">
        <div class="game-summary">
          <div class="game-main">
            <div class="game-identity">
              <div class="game-title-row">
                <div class="game-logo" id="game-logo">
                  <img src="/assets/avatar.svg" alt="">
                </div>
                <h1 id="game-title">Carregando jogo...</h1>
              </div>
              <p id="game-description">Buscando informações do jogo.</p>
              <div class="game-meta-list" id="game-meta-list"></div>
            </div>
          </div>

          <div class="game-actions">
            <button class="primary-button" id="game-follow-button" type="button">Seguir</button>
          </div>
        </div>

        <div class="game-stats" aria-label="Métricas do jogo">
          <button class="stat-button" id="game-followers-button" type="button" aria-controls="game-followers-panel" aria-expanded="false">
            <strong id="game-followers-count">0</strong>
            <span>seguidores</span>
          </button>
          <button class="stat-button stat-static game-stat-link" id="game-listings-button" type="button">
            <strong id="game-listings-count">0</strong>
            <span>anúncios</span>
          </button>
        </div>
      </section>

      <section class="game-grid">
        <section class="game-content" aria-label="Feed do jogo">
          <div class="filter-bar" aria-label="Filtrar feed do jogo">
            <button class="filter-chip is-active" type="button" data-game-feed-filter="all">Posts</button>
            <button class="filter-chip" type="button" data-game-feed-filter="listing">Marketplace</button>
          </div>

          <div class="marketplace-feed-search" id="game-marketplace-feed-search" hidden>
            <label id="game-marketplace-search-label" for="game-marketplace-search">Buscar no Marketplace</label>
            <input id="game-marketplace-search" type="search" placeholder="Buscar anúncio, item ou vendedor">
          </div>

          <div class="feed-list" id="game-feed-list"></div>
        </section>

        <aside class="game-followers-panel" id="game-followers-panel" aria-labelledby="game-followers-title">
          <div class="section-head">
            <h2 id="game-followers-title">Quem segue</h2>
            <div class="game-followers-panel-actions">
              <span id="game-followers-side-count">0</span>
              <button class="ghost-icon game-followers-close" id="game-followers-close" type="button" aria-label="Fechar seguidores">x</button>
            </div>
          </div>
          <div class="people-list" id="game-followers-list"></div>
        </aside>
      </section>
    </main>
  </div>

  <div class="modal-backdrop" id="listing-detail-modal" hidden>
    <section class="listing-detail-modal" role="dialog" aria-modal="true" aria-labelledby="listing-detail-title">
      <div id="listing-detail-content"></div>
    </section>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="/auth-client.js?v=20260722-silent-session-check"></script>
  <script src="/user-search.js?v=20260722-game-short-url" defer></script>
  <script src="/navbar.js?v=20260722-silent-session-check" defer></script>
  <script src="/video-player.js?v=20260721-public-feed" defer></script>
  <script src="/adcash-ads.js?v=20260721-adcash-zones" defer></script>
  <script src="/media-lightbox.js?v=20260722-hide-empty-lightbox-comments" defer></script>
  <script src="/vendor/qrcode.js" defer></script>
  <script src="/share-modal.js?v=20260722-share-title-no-p" defer></script>
  <script src="/report-modal.js" defer></script>
  <script type="module" src="/vendor/emoji-picker-element/index.js"></script>
  <script src="/game.js?v=20260722-follow-guest-signin" defer></script>
</body>
</html>`;

async function getGameHtml(request, env) {
  if (!env?.ASSETS?.fetch) return GAME_HTML;

  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/game";
  assetUrl.search = "";

  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!response.ok) return GAME_HTML;

  const html = await response.text();
  return html.trim() || GAME_HTML;
}

export async function onRequestGet({ request, env }) {
  const html = await getGameHtml(request, env);
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
