import { getSupabaseRestUrl } from "./_shared/auth.js";
import { getServiceHeaders } from "./_shared/admin.js";

const POST_HTML_FALLBACK = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#111827">
  <link rel="icon" type="image/png" href="/assets/favicon.png">
  <title>Post | Gimerr</title>
  <!-- gimerr-og-meta -->
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Gimerr">
        <img class="brand-logo" src="/assets/logo.png" alt="Gimerr">
      </a>

      <div class="search-box">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M10.8 18.1a7.3 7.3 0 1 1 5.1-2.1l4 4-1.4 1.4-4-4a7.3 7.3 0 0 1-3.7 1Zm0-2a5.3 5.3 0 1 0 0-10.6 5.3 5.3 0 0 0 0 10.6Z"/>
        </svg>
        <input id="post-search" type="search" placeholder="Buscar jogos e usuários" aria-label="Buscar jogos e usuários">
      </div>

      <nav class="top-actions" aria-label="Ações principais">
        <a class="auth-button" href="/sign-in.html" hidden>Entrar</a>
        <div class="account-menu" data-account-menu hidden></div>
      </nav>
    </header>

    <main class="post-detail-layout is-loading" id="post-detail-layout">
      <section class="post-detail-card" id="post-detail-card" aria-live="polite">
        <article class="post-card feed-skeleton" aria-label="Carregando post"></article>
      </section>
    </main>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" defer></script>
  <script src="/auth-client.js" defer></script>
  <script src="/user-search.js" defer></script>
  <script src="/navbar.js" defer></script>
  <script src="/video-player.js" defer></script>
  <script src="/media-lightbox.js" defer></script>
  <script src="/post.js" defer></script>
</body>
</html>`;

function cleanText(value, maxLength = 280) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanUuid(value) {
  const text = cleanText(value, 120);
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function absoluteUrl(value, origin) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return new URL(text, origin).toString();
  } catch {
    return "";
  }
}

function getFirstMediaItem(row) {
  const items = Array.isArray(row?.media_items) ? row.media_items : [];
  return items.find((item) => item?.url) || null;
}

function getFirstImageMediaItem(row) {
  const items = Array.isArray(row?.media_items) ? row.media_items : [];
  return items.find((item) => item?.url && String(item?.mediaType || "").startsWith("image/")) || null;
}

function getPostImageUrl(row, origin) {
  const firstMedia = getFirstMediaItem(row);
  const firstImage = getFirstImageMediaItem(row);
  if (row?.post_type === "listing") {
    const listingImageUrl = String(row?.media_type || "").startsWith("image/")
      ? row.media_url
      : firstImage?.url;
    return absoluteUrl(listingImageUrl || row.game_cover_url || "/assets/logo.png", origin);
  }

  const isVideo = String(row?.media_type || firstMedia?.mediaType || "").startsWith("video/")
    || row?.post_type === "video";

  const imageUrl = isVideo
    ? row.video_thumbnail_url || row.game_cover_url || "/assets/logo.png"
    : row.media_url || firstMedia?.url || row.game_cover_url || "/assets/logo.png";

  return absoluteUrl(imageUrl, origin);
}

function getPostDescription(row) {
  const body = cleanText(row?.body, 180);
  if (body) return body;
  if (row?.post_type === "video") return `Vídeo publicado em ${row.game_name || "Gimerr"}.`;
  if (row?.post_type === "listing") return `Anúncio publicado em ${row.game_name || "Gimerr"}.`;
  return `Post publicado em ${row.game_name || "Gimerr"}.`;
}

function getPostTitle(row) {
  const author = cleanText(row?.display_name || row?.username || "Usuário Gimerr", 80);
  const game = cleanText(row?.game_name || "Gimerr", 80);
  if (row?.post_type === "video") return `${author} publicou um vídeo em ${game}`;
  if (row?.post_type === "listing") return `${author} publicou um anúncio em ${game}`;
  return `${author} publicou em ${game}`;
}

function getMetaTags({ row, requestUrl }) {
  const canonical = new URL(requestUrl.toString());
  canonical.search = "";
  canonical.searchParams.set("id", row.id);
  const canonicalUrl = canonical.toString();
  const origin = requestUrl.origin;
  const title = getPostTitle(row);
  const description = getPostDescription(row);
  const image = getPostImageUrl(row, origin);

  return `
  <meta property="og:site_name" content="Gimerr">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:secure_url" content="${escapeHtml(image)}">
  <meta property="og:image:alt" content="${escapeHtml(title)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">`;
}

function injectHead(html, metaTags, row) {
  const title = escapeHtml(`${getPostTitle(row)} | Gimerr`);
  const withTitle = html.replace(/<title>.*?<\/title>/i, `<title>${title}</title>`);
  if (withTitle.includes("<!-- gimerr-og-meta -->")) {
    return withTitle.replace("<!-- gimerr-og-meta -->", metaTags);
  }
  return withTitle.replace("</head>", `${metaTags}\n</head>`);
}

async function getPostHtml(request, env) {
  const assetUrl = new URL("/post.html", request.url);
  if (env.ASSETS?.fetch) {
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    const html = await response.text();
    return html.trim() ? html : POST_HTML_FALLBACK;
  }

  const response = await fetch(assetUrl.toString());
  const html = await response.text();
  return html.trim() ? html : POST_HTML_FALLBACK;
}

async function getPostRow(env, postId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/public_feed_posts`);
  url.searchParams.set("select", "*");
  url.searchParams.set("id", `eq.${postId}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar o post.");
  return rows[0] || null;
}

export async function onRequestGet({ request, env }) {
  const requestUrl = new URL(request.url);
  const postId = cleanUuid(requestUrl.searchParams.get("id") || requestUrl.searchParams.get("post"));
  const html = await getPostHtml(request, env);

  if (!postId) {
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  try {
    const row = await getPostRow(env, postId);
    if (!row) {
      return new Response(html, {
        status: 404,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return new Response(injectHead(html, getMetaTags({ row, requestUrl }), row), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60",
      },
    });
  } catch (error) {
    console.error("post opengraph failed", error);
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }
}
