(function initPostPage() {
  const state = {
    session: null,
    post: null,
    listingSellerDetails: null,
    listingSellerCache: new Map(),
    comments: [],
    commentsError: "",
    commentSubmitting: false,
    editingPost: false,
    editSubmitting: false,
    replyingToCommentId: "",
    followedProfiles: [],
    commentMention: {
      active: false,
      start: -1,
      end: -1,
      selectedIndex: 0,
      items: [],
    },
  };

  const els = {
    layout: document.querySelector("#post-detail-layout"),
    card: document.querySelector("#post-detail-card"),
  };

  if (!els.layout || !els.card) return;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getPostId() {
    const params = new URLSearchParams(window.location.search);
    const rawId = (params.get("id") || params.get("post") || "").trim();
    return rawId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
  }

  function getProfileUrl(profile) {
    if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
    return `./profile?id=${encodeURIComponent(profile?.id || "")}`;
  }

  function normalizeFollowedProfile(profile) {
    if (!profile?.id || !profile.username) return null;
    return {
      id: profile.id,
      displayName: profile.display_name || profile.username || "Usuário Gimerr",
      username: profile.username,
      avatarUrl: profile.avatar_url || "",
    };
  }

  function extractMentionUsernames(text, authorUsername = "") {
    const mentions = [];
    const seen = new Set();
    const author = String(authorUsername || "").toLowerCase();
    const pattern = /(^|[\s([{"'“‘])@([a-z0-9_.]{3,24})(?=$|[\s),.!?:;}"'”’\]])/gi;
    let match;
    while ((match = pattern.exec(String(text || "")))) {
      const username = match[2].replace(/\.+$/, "");
      const key = username.toLowerCase();
      if (!username || key === author || seen.has(key)) continue;
      seen.add(key);
      mentions.push(username);
    }
    return mentions;
  }

  function renderMentionLine(authorName, post) {
    const mentions = extractMentionUsernames(post?.body, post?.author?.username);
    if (!mentions.length) return "";
    const links = mentions.map((username) => (
      `<a href="./profile?u=${encodeURIComponent(username)}">@${escapeHtml(username)}</a>`
    )).join(", ");
    return `<p class="post-mention-line"><strong>${escapeHtml(authorName)}</strong> está com ${links}</p>`;
  }

  function getPostMediaItems(post) {
    const items = Array.isArray(post.mediaItems) ? post.mediaItems : [];
    if (items.length) return items.filter((item) => item?.url);
    return post.mediaUrl
      ? [{ url: post.mediaUrl, mediaType: post.mediaType }]
      : [];
  }

  function renderImageLightboxAttrs(post, alt) {
    const author = post.author || {};
    return [
      "data-image-lightbox",
      `data-image-alt="${escapeHtml(alt)}"`,
      `data-image-author-name="${escapeHtml(author.displayName || author.username || "Usuário Gimerr")}"`,
      `data-image-author-username="${escapeHtml(author.username || "")}"`,
      `data-image-author-avatar="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}"`,
      `data-image-body="${escapeHtml(post.body || "")}"`,
      `data-image-post-id="${escapeHtml(post.id || "")}"`,
    ].join(" ");
  }

  function renderImageGalleryAttrs(items) {
    const payload = items
      .filter((item) => item?.url)
      .slice(0, 15)
      .map((item, index) => ({
        url: item.url,
        alt: `Imagem ${index + 1} do anúncio`,
      }));
    return `data-image-items="${escapeHtml(JSON.stringify(payload))}"`;
  }

  function formatVideoViewCount(value) {
    const count = Number(value || 0);
    const formatted = new Intl.NumberFormat("pt-BR").format(count);
    return count === 1 ? "1 visualização" : `${formatted} visualizações`;
  }

  function renderVideoPoster(post, item) {
    const poster = post.videoThumbnailUrl || "";
    return `
      <div class="video-media" data-video-view-container data-post-id="${escapeHtml(post.id || "")}">
        <button class="video-lazy-button media-frame" type="button" data-video-post-id="${escapeHtml(post.id || "")}" data-video-src="${escapeHtml(item.url)}" data-video-type="${escapeHtml(item.mediaType || "video/mp4")}" ${poster ? `data-video-poster="${escapeHtml(poster)}"` : ""} aria-label="Reproduzir vídeo">
          ${poster ? `<img class="video-lazy-poster" src="${escapeHtml(poster)}" alt="">` : `<span class="video-lazy-empty">Vídeo</span>`}
          <span class="video-lazy-play" aria-hidden="true"></span>
        </button>
        <span class="video-view-counter" data-video-view-count data-post-id="${escapeHtml(post.id || "")}">${escapeHtml(formatVideoViewCount(post.videoViewCount))}</span>
      </div>
    `;
  }

  function renderPostMedia(post) {
    const items = getPostMediaItems(post);
    if (!items.length) return "";
    const [firstItem] = items;
    if (firstItem.mediaType?.startsWith("video/")) {
      return renderVideoPoster(post, firstItem);
    }
    if (items.length === 1) {
      return `
        <button class="media-zoom-button" type="button" data-image-src="${escapeHtml(firstItem.url)}" ${renderImageLightboxAttrs(post, "Imagem do post")}>
          <img class="media-frame" src="${escapeHtml(firstItem.url)}" alt="">
        </button>
      `;
    }
    return `
      <button class="media-zoom-button listing-preview-button" type="button" data-image-src="${escapeHtml(firstItem.url)}" data-image-index="0" ${renderImageGalleryAttrs(items)} ${renderImageLightboxAttrs(post, "Imagem do anúncio")}>
        <img src="${escapeHtml(firstItem.url)}" alt="">
        <span class="listing-preview-count">+${items.length - 1}</span>
      </button>
    `;
  }

  function renderTextWithMentions(text, authorUsername = "") {
    const value = String(text || "");
    const author = String(authorUsername || "").toLowerCase();
    const pattern = /(^|[\s([{"'“‘])@([a-z0-9_.]{3,24})(?=$|[\s),.!?:;}"'”’\]])/gi;
    let output = "";
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(value))) {
      const username = match[2].replace(/\.+$/, "");
      const key = username.toLowerCase();
      const atIndex = match.index + match[1].length;
      output += escapeHtml(value.slice(lastIndex, atIndex));
      if (key && key !== author) {
        output += `<a class="inline-mention" href="./profile?u=${encodeURIComponent(username)}">@${escapeHtml(username)}</a>`;
      } else {
        output += escapeHtml(`@${username}`);
      }
      lastIndex = atIndex + username.length + 1;
    }

    output += escapeHtml(value.slice(lastIndex));
    return output;
  }

  function renderExpandableText(textHtml, rawText, className = "post-text", limit = 420) {
    if (!String(rawText || "").trim()) return "";
    const shouldCollapse = String(rawText || "").length > limit;
    return `
      <p class="${className}${shouldCollapse ? " expandable-text" : ""}" ${shouldCollapse ? "data-expandable-text" : ""}>${textHtml}</p>
      ${shouldCollapse ? `<button class="text-button expandable-text-toggle" type="button" data-expandable-toggle>Mostrar mais</button>` : ""}
    `;
  }

  function getActiveMention(text, cursor) {
    const beforeCursor = String(text || "").slice(0, cursor);
    const match = beforeCursor.match(/(^|[\s([{"'“‘])@([a-z0-9_.]{1,24})$/i);
    if (!match) return null;
    const query = match[2] || "";
    if (!query) return null;
    return {
      start: beforeCursor.length - query.length - 1,
      end: cursor,
      query: query.toLowerCase(),
    };
  }

  function getMentionMatches(query) {
    if (!query) return [];
    const normalized = query.toLowerCase();
    return state.followedProfiles
      .filter((profile) => {
        const username = String(profile.username || "").toLowerCase();
        const displayName = String(profile.displayName || "").toLowerCase();
        return username.startsWith(normalized) || displayName.startsWith(normalized);
      })
      .slice(0, 6);
  }

  function closeCommentMentionSuggestions() {
    state.commentMention = {
      active: false,
      start: -1,
      end: -1,
      selectedIndex: 0,
      items: [],
      textarea: null,
    };
    document.querySelectorAll("[data-comment-mention-suggestions], #comment-mention-suggestions").forEach((container) => {
      container.hidden = true;
      container.innerHTML = "";
    });
  }

  function renderCommentMentionSuggestions() {
    const container = state.commentMention.textarea?.closest("form")?.querySelector("[data-comment-mention-suggestions], #comment-mention-suggestions")
      || document.querySelector("#comment-mention-suggestions");
    if (!container) return;
    if (!state.commentMention.active || !state.commentMention.items.length) {
      closeCommentMentionSuggestions();
      return;
    }

    container.hidden = false;
    container.innerHTML = state.commentMention.items.map((profile, index) => `
      <button class="composer-mention-option${index === state.commentMention.selectedIndex ? " is-active" : ""}" type="button" data-comment-mention-index="${index}">
        <span class="user-search-avatar">
          <img src="${escapeHtml(profile.avatarUrl || "./assets/avatar.svg")}" alt="">
        </span>
        <span class="composer-mention-copy">
          <strong>${escapeHtml(profile.displayName)}</strong>
          <span>@${escapeHtml(profile.username)}</span>
        </span>
      </button>
    `).join("");
  }

  function updateCommentMentionSuggestions(textarea) {
    if (!textarea) return;
    const activeMention = getActiveMention(textarea.value, textarea.selectionStart);
    if (!activeMention) {
      closeCommentMentionSuggestions();
      return;
    }

    const items = getMentionMatches(activeMention.query);
    if (!items.length) {
      closeCommentMentionSuggestions();
      return;
    }

    state.commentMention = {
      active: true,
      start: activeMention.start,
      end: activeMention.end,
      selectedIndex: Math.min(state.commentMention.selectedIndex || 0, items.length - 1),
      items,
      textarea,
    };
    renderCommentMentionSuggestions();
  }

  function insertCommentMention(profile) {
    const textarea = state.commentMention.textarea || document.querySelector("#comment-body");
    if (!textarea || !profile || !state.commentMention.active) return;
    const text = textarea.value;
    const before = text.slice(0, state.commentMention.start);
    const after = text.slice(state.commentMention.end);
    const nextValue = `${before}@${profile.username} ${after}`;
    const maxLength = Number(textarea.maxLength || 0);
    const boundedValue = maxLength > 0 ? nextValue.slice(0, maxLength) : nextValue;
    const nextCursor = Math.min(before.length + profile.username.length + 2, boundedValue.length);
    textarea.value = boundedValue;
    closeCommentMentionSuggestions();
    textarea.focus();
    textarea.setSelectionRange(nextCursor, nextCursor);
  }

  function getGameUrl(game) {
    if (!game) return "./game";
    return game.slug
      ? `/g/${encodeURIComponent(game.slug)}`
      : `./game?id=${encodeURIComponent(game.id)}`;
  }

  function formatRelativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "agora";
    const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (diffSeconds < 60) return "agora";
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `há ${diffMinutes} min`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `há ${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `há ${diffDays} d`;
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }

  function detectListingCurrency(value) {
    const text = String(value || "");
    if (text.includes("US$")) return "USD";
    if (text.includes("€")) return "EUR";
    if (text.includes("JP¥")) return "JPY";
    if (text.includes("£")) return "GBP";
    if (text.includes("CN¥")) return "CNY";
    if (text.includes("R$")) return "BRL";
    return "";
  }

  function parseListingPriceInput(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const numeric = text
      .replace(/[^\d.,-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const number = Number(numeric);
    return Number.isFinite(number) && number >= 0 ? String(number) : "";
  }

  function parseListingBody(body, mediaItems = []) {
    const text = String(body || "");
    const marker = "\n\nItens:\n";
    const markerIndex = text.indexOf(marker);
    const description = markerIndex >= 0 ? text.slice(0, markerIndex) : "";
    const itemsText = markerIndex >= 0 ? text.slice(markerIndex + marker.length) : text.replace(/^Itens:\n/i, "");
    const lines = itemsText.split("\n").map((line) => line.trim()).filter(Boolean);
    let detectedCurrency = "";
    const listingImages = mediaItems.filter((item) => String(item?.mediaType || "").startsWith("image/"));
    const mediaByPosition = new Map(listingImages
      .filter((item) => Number.isInteger(Number(item?.position)))
      .map((item) => [Number(item.position), item]));
    const mediaByName = new Map(listingImages
      .filter((item) => item?.itemName)
      .map((item) => [String(item.itemName).toLowerCase(), item]));
    const getMediaForLine = (name, index) => (
      mediaByPosition.get(index)
      || mediaByName.get(String(name || "").toLowerCase())
      || null
    );
    const items = lines.map((line, index) => {
      const [namePart, ...priceParts] = line.split(/\s+-\s+/);
      const mediaItem = getMediaForLine(namePart, index);
      const priceLabel = priceParts.join(" - ") || mediaItem?.priceLabel || "";
      if (!detectedCurrency) detectedCurrency = detectListingCurrency(priceLabel);
      return {
        name: namePart || mediaItem?.itemName || "",
        price: parseListingPriceInput(priceLabel),
        priceLabel,
        mediaItem,
        previewUrl: mediaItem?.url || "",
      };
    });
    return {
      description,
      currency: detectedCurrency || "BRL",
      items,
    };
  }

  function getListingCardData(post) {
    const rawMediaItems = Array.isArray(post?.mediaItems) ? post.mediaItems : getPostMediaItems(post);
    const parsed = parseListingBody(post?.body || "", rawMediaItems);
    const itemCount = parsed.items.filter((item) => item.name || item.price || item.priceLabel || item.mediaItem || item.previewUrl).length;
    return { ...parsed, itemCount };
  }

  function formatListingItemCount(count) {
    const value = Number(count || 0);
    if (value === 1) return "1 item";
    return `${new Intl.NumberFormat("pt-BR").format(value)} itens`;
  }

  function formatCountLabel(value, singular, plural) {
    const count = Number(value || 0);
    return `${new Intl.NumberFormat("pt-BR").format(count)} ${count === 1 ? singular : plural}`;
  }

  function getWhatsappUrl(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits ? `https://wa.me/${digits}` : "";
  }

  function getPhoneLabel(phone) {
    return String(phone || "").replace(/^\+/, "+");
  }

  function getPlatformMeta(platform) {
    const id = String(platform || "").trim().toLowerCase();
    if (id === "discord") return { id, label: "Discord", icon: "./assets/discord.svg" };
    if (id === "twitch") return { id, label: "Twitch", icon: "./assets/twitch.svg" };
    return { id: id || "platform", label: platform || "Plataforma", icon: "" };
  }

  function renderSellerContacts(details) {
    const profile = details?.profile || {};
    const links = Array.isArray(details?.platformLinks) ? details.platformLinks : [];
    const contactItems = [];
    if (profile.phone_e164) {
      contactItems.push(`<a href="tel:${escapeHtml(profile.phone_e164)}">Telefone: ${escapeHtml(getPhoneLabel(profile.phone_e164))}</a>`);
      if (profile.phone_contact_whatsapp) {
        const whatsappUrl = getWhatsappUrl(profile.phone_e164);
        if (whatsappUrl) {
          contactItems.push(`
            <a class="info-pill contact-pill whatsapp-contact-pill" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener">
              <img src="./assets/whatsapp.svg" alt="">
              WhatsApp
            </a>
          `);
        }
      }
      if (profile.phone_contact_telegram) {
        const phoneDigits = String(profile.phone_e164 || "").replace(/\D/g, "");
        if (phoneDigits) {
          contactItems.push(`
            <a class="info-pill contact-pill telegram-contact-button" href="tg://resolve?phone=${escapeHtml(phoneDigits)}">
              <img src="./assets/telegram.svg" alt="">
              Telegram
            </a>
          `);
        }
      }
    }
    links.forEach((link) => {
      const platformMeta = getPlatformMeta(link.platform);
      const handle = link.handle || platformMeta.label;
      const label = `${platformMeta.label}${link.handle ? `: ${link.handle}` : ""}`;
      if (link.profile_url) {
        contactItems.push(`
          <a class="info-pill platform-pill platform-pill-${escapeHtml(platformMeta.id)}" href="${escapeHtml(link.profile_url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
            ${platformMeta.icon ? `<img src="${escapeHtml(platformMeta.icon)}" alt="">` : ""}
            <span>${escapeHtml(handle)}</span>
          </a>
        `);
      } else {
        contactItems.push(`
          <span class="info-pill platform-pill platform-pill-${escapeHtml(platformMeta.id)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
            ${platformMeta.icon ? `<img src="${escapeHtml(platformMeta.icon)}" alt="">` : ""}
            <span>${escapeHtml(handle)}</span>
          </span>
        `);
      }
    });
    return contactItems.length
      ? contactItems.map((item) => `<li>${item}</li>`).join("")
      : `<li><span>Sem contatos públicos.</span></li>`;
  }

  function getListingRecommenders(details) {
    return (details?.recommenders || []).map((user) => ({
      id: user.recommender_id || user.id || "",
      display_name: user.display_name || "",
      username: user.username || "",
      avatar_url: user.avatar_url || "",
    })).filter((user) => user.id || user.username);
  }

  function renderListingRecommendationsControl(details, stats, authorId) {
    const recommenders = getListingRecommenders(details);
    const count = Number(stats?.recommendations_count || recommenders.length || 0);
    return `
      <button class="listing-seller-stat-button" type="button" data-listing-recommendations data-seller-id="${escapeHtml(authorId || "")}">
        ${escapeHtml(formatCountLabel(count, "recomendação", "recomendações"))}
      </button>
    `;
  }

  function ensureListingPeopleModal() {
    let modal = document.querySelector("#listing-people-modal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.id = "listing-people-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <section class="people-modal" role="dialog" aria-modal="true" aria-labelledby="listing-people-modal-title">
        <div class="modal-head">
          <h2 id="listing-people-modal-title">Recomendações</h2>
          <button class="ghost-icon" type="button" data-listing-people-close aria-label="Fechar">x</button>
        </div>
        <div class="people-list" data-listing-people-list></div>
      </section>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.target === modal || target?.closest("[data-listing-people-close]")) {
        modal.hidden = true;
      }
    });
    return modal;
  }

  async function openListingRecommendationsModal(authorId) {
    const details = await loadListingSellerDetails(authorId);
    const users = getListingRecommenders(details);
    const modal = ensureListingPeopleModal();
    const list = modal.querySelector("[data-listing-people-list]");
    list.innerHTML = users.length ? users.map((user) => `
      <a class="people-row" href="${getProfileUrl({ id: user.id, username: user.username })}">
        <div class="post-avatar">
          <img src="${escapeHtml(user.avatar_url || "./assets/avatar.svg")}" alt="">
        </div>
        <div>
          <strong>${escapeHtml(user.display_name || user.username || "Usuário Gimerr")}</strong>
          ${user.username ? `<span>@${escapeHtml(user.username)}</span>` : ""}
        </div>
      </a>
    `).join("") : `<div class="empty-state">Nenhum usuário por aqui.</div>`;
    modal.hidden = false;
    modal.querySelector("[data-listing-people-close]")?.focus();
  }

  function closePostMenus(exceptMenu = null) {
    document.querySelectorAll("[data-post-menu]").forEach((menu) => {
      if (exceptMenu && menu === exceptMenu) return;
      const popover = menu.querySelector(".post-menu-popover");
      const toggle = menu.querySelector("[data-post-menu-toggle]");
      if (popover) popover.hidden = true;
      if (toggle) toggle.setAttribute("aria-expanded", "false");
    });
  }

  function togglePostMenu(button) {
    const menu = button.closest("[data-post-menu]");
    const popover = menu?.querySelector(".post-menu-popover");
    if (!menu || !popover) return;
    const willOpen = popover.hidden;
    closePostMenus(menu);
    popover.hidden = !willOpen;
    button.setAttribute("aria-expanded", String(willOpen));
  }

  function renderPostMenu(post) {
    const postId = escapeHtml(post.id);
    const ownerId = post.author?.id || post.profileId || post.profile_id || "";
    const isOwner = state.session?.user?.id && String(ownerId) === String(state.session.user.id);
    const isListing = post.type === "listing";
    return `
      <div class="post-menu" data-post-menu>
        <button class="ghost-icon post-menu-button" type="button" data-post-menu-toggle data-post-id="${postId}" aria-label="Abrir menu do post" aria-expanded="false">
          <span aria-hidden="true">&#8942;</span>
        </button>
        <div class="post-menu-popover" hidden>
          ${!isOwner ? `<button type="button" data-post-report data-post-id="${postId}">Denunciar</button>` : ""}
          ${isOwner && isListing ? `<a href="./?editListing=${encodeURIComponent(post.id)}">Editar</a>` : ""}
          ${isOwner && !isListing ? `<button type="button" data-post-edit data-post-id="${postId}">Editar</button>` : ""}
          ${isOwner ? `<button class="danger" type="button" data-post-delete data-post-id="${postId}">Excluir</button>` : ""}
        </div>
      </div>
    `;
  }

  function renderListingDetail(post, sellerDetails = null) {
    const listingData = getListingCardData(post);
    const author = post.author || {};
    const sellerProfile = sellerDetails?.profile || {};
    const stats = sellerDetails?.stats || {};
    const sellerName = sellerProfile.display_name || author.displayName || author.username || "Vendedor Gimerr";
    const sellerUsername = sellerProfile.username || author.username || "";
    const sellerAvatar = sellerProfile.avatar_url || author.avatarUrl || "./assets/avatar.svg";
    const canMessageSeller = author.id && author.id !== state.session?.user?.id;
    const mediaItems = getPostMediaItems(post);
    const listingVideo = mediaItems.find((item) => String(item?.mediaType || "").startsWith("video/"));
    const items = listingData.items.filter((item) => item.name || item.price || item.priceLabel || item.mediaItem || item.previewUrl);
    const galleryItems = items
      .filter((item) => item.previewUrl)
      .map((item, index) => ({
        url: item.previewUrl,
        alt: item.name ? `Imagem do item ${item.name}` : `Imagem do item ${index + 1}`,
      }));
    const itemList = items.map((item) => {
      const galleryIndex = item.previewUrl
        ? galleryItems.findIndex((galleryItem) => galleryItem.url === item.previewUrl)
        : -1;
      const imageAlt = item.name ? `Imagem do item ${item.name}` : "Imagem do item";
      return `
        <article class="listing-detail-item">
          ${item.previewUrl ? `
            <button class="listing-detail-item-media" type="button" data-image-src="${escapeHtml(item.previewUrl)}" data-image-index="${Math.max(0, galleryIndex)}" data-image-items="${escapeHtml(JSON.stringify(galleryItems))}" ${renderImageLightboxAttrs(post, imageAlt)} aria-label="Ampliar imagem do item">
              <img src="${escapeHtml(item.previewUrl)}" alt="">
            </button>
          ` : `
            <div class="listing-detail-item-media">
              <span>Sem imagem</span>
            </div>
          `}
          <div>
            <strong>${escapeHtml(item.name || "Item")}</strong>
            ${item.priceLabel ? `<span>${escapeHtml(item.priceLabel)}</span>` : ""}
          </div>
        </article>
      `;
    }).join("");

    return `
      <div class="listing-detail-grid post-listing-detail">
        <section class="listing-detail-main">
          <div class="listing-detail-actions">
            <button class="post-action-button" type="button" data-post-share data-post-id="${escapeHtml(post.id)}">Compartilhar</button>
            ${renderPostMenu(post)}
          </div>
          <div>
            <a class="channel-line" href="${getGameUrl(post.game)}">
              <span class="channel-game-logo" aria-hidden="true">
                <img src="${escapeHtml(post.game?.coverUrl || "./assets/avatar.svg")}" alt="">
              </span>
              <span>Em ${escapeHtml(post.game?.name || "Game")} ${escapeHtml(formatRelativeTime(post.createdAt))}</span>
            </a>
            <h1 id="listing-detail-title">${escapeHtml(formatListingItemCount(listingData.itemCount))}</h1>
            ${listingData.description ? `<p class="listing-detail-description">${escapeHtml(listingData.description)}</p>` : ""}
          </div>
          ${listingVideo ? renderVideoPoster(post, listingVideo) : ""}
          <div class="listing-detail-items">
            ${itemList || `<p class="empty-state">Nenhum item informado.</p>`}
          </div>
        </section>
        <aside class="listing-detail-seller">
          <a class="listing-seller-head" href="${getProfileUrl({ id: author.id, username: sellerUsername })}">
            <img src="${escapeHtml(sellerAvatar)}" alt="">
            <span>
              <strong>${escapeHtml(sellerName)}</strong>
              ${sellerUsername ? `<small>@${escapeHtml(sellerUsername)}</small>` : ""}
            </span>
          </a>
          <div class="listing-seller-stats">
            ${renderListingRecommendationsControl(sellerDetails, stats, author.id)}
          </div>
          ${canMessageSeller ? `
            <a class="primary-button listing-message-button message-action-button" href="./messages?listingPostId=${encodeURIComponent(post.id)}">
              <img src="./assets/message.svg" alt="" aria-hidden="true">
              <span>Enviar mensagem</span>
            </a>
          ` : ""}
          <div class="listing-seller-contact">
            <strong>Contato</strong>
            <ul>${renderSellerContacts(sellerDetails)}</ul>
          </div>
        </aside>
      </div>
    `;
  }

  function renderPostTextBlock(post) {
    if (!state.editingPost) {
      return post.body ? renderExpandableText(renderTextWithMentions(post.body, post.author?.username), post.body, "post-text", 420) : "";
    }
    return `
      <form class="post-edit-form" data-post-edit-form data-post-id="${escapeHtml(post.id || "")}">
        <textarea class="post-edit-textarea" name="body" rows="4" maxlength="5000">${escapeHtml(post.body || "")}</textarea>
        <div class="post-edit-actions">
          <button class="primary-button" type="submit" ${state.editSubmitting ? "disabled" : ""}>${state.editSubmitting ? "Salvando..." : "Salvar"}</button>
          <button class="text-button" type="button" data-post-edit-cancel data-post-id="${escapeHtml(post.id || "")}" ${state.editSubmitting ? "disabled" : ""}>Cancelar</button>
        </div>
      </form>
    `;
  }

  async function copyTextToClipboard(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  async function sharePost() {
    const post = state.post;
    const title = post?.type === "video"
      ? "Veja este vídeo no Gimerr"
      : post?.type === "listing"
        ? "Veja este anúncio no Gimerr"
        : "Veja este post no Gimerr";
    const url = window.location.href;

    if (window.GimerrShare?.openPostShare) {
      await window.GimerrShare.openPostShare({
        postId: post?.id || new URLSearchParams(window.location.search).get("id") || "",
        post,
        title,
        text: `Publicado em ${post?.game?.name || "Gimerr"}`,
        url,
      });
      return;
    }

    await copyTextToClipboard(url);
    window.alert("Link copiado.");
  }

  async function reportPost(postId) {
    if (!state.session?.access_token) {
      window.location.assign("./sign-in.html");
      return;
    }

    window.GimerrReport?.open({
      postId,
      token: state.session.access_token,
    });
  }

  async function deletePost(postId) {
    if (!state.session?.access_token) return;
    const confirmed = window.confirm("Apagar este post? Essa ação é irreversível.");
    if (!confirmed) return;

    const response = await fetch("/api/posts/delete", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ postId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível apagar este post.");

    els.card.innerHTML = `<div class="post-card empty-state">Post apagado.</div>`;
  }

  async function editPostText(postId) {
    if (!state.session?.access_token || !state.post || state.post.type === "listing") return;
    state.editingPost = true;
    renderPost();
    window.setTimeout(() => {
      const textarea = document.querySelector(`[data-post-edit-form][data-post-id="${CSS.escape(String(postId || ""))}"] textarea`);
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  async function savePostText(postId, body) {
    if (!state.session?.access_token || !state.post || state.post.type === "listing") return;
    state.editSubmitting = true;
    const response = await fetch("/api/posts/update", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ postId, body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível editar este post.");

    state.post = {
      ...state.post,
      body: payload.post?.body ?? String(body || "").trim(),
    };
    state.editingPost = false;
    state.editSubmitting = false;
    renderPost();
  }

  function renderMissing(message) {
    els.layout.classList.remove("is-loading");
    els.card.innerHTML = `<div class="post-card empty-state">${escapeHtml(message)}</div>`;
  }

  function renderPost() {
    const post = state.post;
    if (!post) return;

    const author = post.author || {};
    const authorName = author.displayName || "Usuário Gimerr";
    const authorHandle = author.username ? `@${author.username}` : "@gimerr";
    const media = renderPostMedia(post);

    document.title = `${post.type === "listing" ? "Anúncio" : authorName} | Gimerr`;
    els.layout.classList.remove("is-loading");
    els.layout.classList.toggle("is-listing-detail", post.type === "listing");
    if (post.type === "listing") {
      els.card.innerHTML = renderListingDetail(post, state.listingSellerDetails);
      window.GimerrVideoPlayer?.prepare(els.card);
      return;
    }

    els.card.innerHTML = `
      <article class="post-card post-detail-post">
        ${media}
        <div class="post-body">
          ${renderMentionLine(authorName, post)}
          ${post.type === "listing" ? `<span class="post-marketplace-badge">Anúncio</span>` : ""}
          <div class="post-meta">
            <a class="author-block" href="${getProfileUrl(author)}">
              <div class="post-avatar">
                <img src="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}" alt="">
              </div>
              <div class="author-copy">
                <strong>${escapeHtml(authorName)}</strong>
                <span>${escapeHtml(authorHandle)}</span>
              </div>
            </a>
            <div class="post-card-tools">
              ${renderPostMenu(post)}
            </div>
          </div>
          <div>
            ${renderPostTextBlock(post)}
          </div>
          <a class="channel-line" href="${getGameUrl(post.game)}">
            <span class="channel-game-logo" aria-hidden="true">
              <img src="${escapeHtml(post.game?.coverUrl || "./assets/avatar.svg")}" alt="">
            </span>
            <span>Em ${escapeHtml(post.game?.name || "Game")} ${escapeHtml(formatRelativeTime(post.createdAt))}</span>
          </a>
        </div>
      </article>
      ${post.type === "listing" ? "" : renderCommentsSection()}
    `;
    window.GimerrVideoPlayer?.prepare(els.card);
  }

  function renderCommentsSection() {
    const commentCount = state.comments.length;
    const commentsById = buildCommentsById(state.comments);
    const comments = state.commentsError
      ? `<p class="comments-empty">${escapeHtml(state.commentsError)}</p>`
      : state.comments.length
        ? state.comments.map((comment) => renderComment(comment, commentsById)).join("")
        : `<p class="comments-empty">Nenhum comentário ainda.${state.session?.user ? "" : ` <a class="comments-login-link" href="./sign-in.html">Entre para comentar</a>.`}</p>`;
    const form = state.session?.user
      ? `
        <form class="comment-form" id="comment-form" data-comment-form>
          <textarea id="comment-body" rows="3" maxlength="5000" placeholder="Escreva um comentário"></textarea>
          <div class="composer-mention-suggestions comment-mention-suggestions" id="comment-mention-suggestions" data-comment-mention-suggestions hidden></div>
          ${renderCommentTools()}
          <div class="comment-form-actions">
            <span></span>
            <button class="primary-button" type="submit" ${state.commentSubmitting ? "disabled" : ""}>
              ${state.commentSubmitting ? "Comentando..." : "Comentar"}
            </button>
          </div>
          <p class="field-feedback" id="comment-feedback"></p>
        </form>
      `
      : `<a class="text-button comment-login-link" href="./sign-in.html">Entre para comentar</a>`;

    return `
      <section class="comments-panel" aria-labelledby="comments-title">
        <div class="comments-head">
          <h2 id="comments-title">Comentários</h2>
          <span>${commentCount}</span>
        </div>
        ${form}
        <div class="comments-list">
          ${comments}
        </div>
      </section>
    `;
  }

  function groupCommentsByParent(comments) {
    return (comments || []).reduce((groups, comment) => {
      const key = comment.parentCommentId || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(comment);
      return groups;
    }, new Map());
  }

  function getReplyMention(comment) {
    const username = comment?.author?.username ? `@${comment.author.username} ` : "";
    return escapeHtml(username);
  }

  function buildCommentsById(comments) {
    return new Map((comments || []).map((comment) => [String(comment.id), comment]));
  }

  function renderCommentReplyReference(comment, commentsById) {
    const parentId = comment.parentCommentId || "";
    if (!parentId) return "";
    const localParent = commentsById?.get(String(parentId));
    const parent = localParent ? {
      id: localParent.id,
      status: "active",
      author: localParent.author,
    } : comment.parent;
    if (!parent || parent.status !== "active") {
      return `<span class="comment-reply-reference is-deleted">Em resposta a comentário excluído</span>`;
    }
    const parentAuthor = parent.author || {};
    const label = parentAuthor.displayName || parentAuthor.username || "comentário";
    return `<a class="comment-reply-reference" href="#comment-${escapeHtml(parentId)}">Em resposta a ${escapeHtml(label)}</a>`;
  }

  function renderCommentMedia(comment) {
    if (!comment?.mediaUrl || !String(comment.mediaType || "").startsWith("image/")) return "";
    const url = escapeHtml(comment.mediaUrl);
    return `
      <button class="comment-media-button" type="button" data-image-lightbox data-image-src="${url}" data-image-alt="Imagem do comentário">
        <img src="${url}" alt="Imagem do comentário">
      </button>
    `;
  }

  function renderCommentTools() {
    return `
      <div class="comment-emoji-picker" data-comment-emoji-picker hidden></div>
      <div class="comment-form-tools">
        <label class="comment-tool-button" title="Adicionar imagem">
          <img src="./assets/camera.svg.svg" alt="" aria-hidden="true">
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-comment-image>
        </label>
        <button class="comment-tool-button" type="button" data-comment-emoji aria-label="Abrir emojis"><img src="./assets/emoji.svg.svg" alt="" aria-hidden="true"></button>
      </div>
      <div class="comment-image-preview" data-comment-image-preview hidden></div>
    `;
  }

  function renderReplyForm(comment) {
    if (String(state.replyingToCommentId) !== String(comment.id)) return "";
    if (!state.session?.user) return `<a class="text-button comment-login-link" href="./sign-in.html">Entre para responder</a>`;
    return `
      <form class="comment-form inline-reply-form" data-comment-form data-parent-comment-id="${escapeHtml(comment.id)}">
        <textarea rows="2" maxlength="5000" placeholder="Responder comentário">${getReplyMention(comment)}</textarea>
        <div class="composer-mention-suggestions comment-mention-suggestions" data-comment-mention-suggestions hidden></div>
        ${renderCommentTools()}
        <div class="comment-form-actions">
          <button class="text-button" type="button" data-comment-reply-cancel>Cancelar</button>
          <button class="primary-button" type="submit" ${state.commentSubmitting ? "disabled" : ""}>
            ${state.commentSubmitting ? "Respondendo..." : "Responder"}
          </button>
        </div>
        <p class="field-feedback" data-comment-feedback></p>
      </form>
    `;
  }

  function renderComment(comment, commentsById) {
    const author = comment.author || {};
    const authorName = author.displayName || "Usuário Gimerr";
    const authorHandle = author.username ? `@${author.username}` : "";
    const canDelete = state.session?.user?.id && String(author.id) === String(state.session.user.id);
    return `
      <div class="comment-thread">
        <article class="comment-item" id="comment-${escapeHtml(comment.id)}">
          <a class="post-avatar" href="${getProfileUrl(author)}">
            <img src="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}" alt="">
          </a>
          <div class="comment-copy">
            <div class="comment-meta">
              <a href="${getProfileUrl(author)}">${escapeHtml(authorName)}</a>
              <span>${escapeHtml([authorHandle, formatRelativeTime(comment.createdAt)].filter(Boolean).join(" · "))}</span>
            </div>
            ${renderCommentReplyReference(comment, commentsById)}
            ${comment.body ? renderExpandableText(renderTextWithMentions(comment.body, author.username), comment.body, "comment-text", 280) : ""}
            ${renderCommentMedia(comment)}
            <div class="comment-actions">
              <button class="text-button comment-reply-button" type="button" data-comment-reply data-comment-id="${escapeHtml(comment.id)}">Responder</button>
              ${canDelete ? `
                <button class="comment-delete-button" type="button" data-comment-delete data-comment-id="${escapeHtml(comment.id)}" aria-label="Apagar comentário" title="Apagar comentário">
                  <img src="./assets/trash.svg" alt="">
                </button>
              ` : ""}
            </div>
            ${renderReplyForm(comment)}
          </div>
        </article>
      </div>
    `;
  }

  async function loadSession() {
    if (!window.GimerrAuth) return;
    const { data } = await window.GimerrAuth.getSession();
    state.session = data.session || null;
  }

  async function loadRecommendedProfiles() {
    if (!state.session?.user || !window.GimerrAuth) {
      state.followedProfiles = [];
      return;
    }

    const client = await window.GimerrAuth.getClient();
    const { data: recommendations, error: recommendationsError } = await client
      .from("profile_recommendations")
      .select("recommended_id")
      .eq("recommender_id", state.session.user.id)
      .order("created_at", { ascending: false });

    if (recommendationsError) throw recommendationsError;

    const followedIds = [...new Set((recommendations || [])
      .map((row) => row.recommended_id)
      .filter(Boolean))];

    if (!followedIds.length) {
      state.followedProfiles = [];
      return;
    }

    const { data: profiles, error: profilesError } = await client
      .from("public_profiles")
      .select("id, display_name, username, avatar_url")
      .in("id", followedIds);

    if (profilesError) throw profilesError;

    const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
    state.followedProfiles = followedIds
      .map((id) => normalizeFollowedProfile(byId.get(id)))
      .filter(Boolean);
  }

  async function loadListingSellerDetails(authorId) {
    if (!authorId || !window.GimerrAuth) return null;
    if (state.listingSellerCache.has(authorId)) return state.listingSellerCache.get(authorId);
    const client = await window.GimerrAuth.getClient();
    const [profileResult, statsResult, linksResult, recommendersResult] = await Promise.all([
      client
        .from("public_profiles")
        .select("id, display_name, username, avatar_url, phone_e164, phone_contact_whatsapp, phone_contact_telegram")
        .eq("id", authorId)
        .maybeSingle(),
      client
        .from("public_profile_stats")
        .select("profile_id, recommendations_count")
        .eq("profile_id", authorId)
        .maybeSingle(),
      client
        .from("public_profile_platform_links")
        .select("platform, handle, profile_url")
        .eq("profile_id", authorId),
      client
        .from("public_profile_recommenders")
        .select("recommender_id, display_name, username, avatar_url")
        .eq("profile_id", authorId),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (statsResult.error) throw statsResult.error;
    if (linksResult.error) throw linksResult.error;
    if (recommendersResult.error) throw recommendersResult.error;
    const details = {
      profile: profileResult.data || {},
      stats: statsResult.data || {},
      platformLinks: linksResult.data || [],
      recommenders: recommendersResult.data || [],
    };
    state.listingSellerCache.set(authorId, details);
    return details;
  }

  async function recordListingView(postId) {
    if (!postId || !state.session?.access_token) return;
    try {
      await fetch("/api/posts/listing-view", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${state.session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ postId }),
      });
    } catch (error) {
      console.warn("Não foi possível registrar visualização do anúncio.", error);
    }
  }

  async function loadPost() {
    const postId = getPostId();
    if (!postId) {
      renderMissing("Post não encontrado.");
      return;
    }

    const response = await fetch(`/api/posts/detail?id=${encodeURIComponent(postId)}`, {
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      renderMissing(payload.error || "Não foi possível carregar este post.");
      return;
    }

    state.post = payload.post;
    if (state.post?.type === "listing") {
      await recordListingView(postId);
      state.listingSellerDetails = await loadListingSellerDetails(state.post.author?.id).catch((error) => {
        console.warn("Não foi possível carregar detalhes do vendedor.", error);
        return null;
      });
    } else {
      await loadComments(postId).catch((error) => {
        console.warn("Não foi possível carregar comentários.", error);
        state.commentsError = error.message || "Não foi possível carregar comentários.";
      });
    }
    renderPost();
  }

  async function loadComments(postId = getPostId()) {
    if (!postId) return;
    const response = await fetch(`/api/posts/comments?postId=${encodeURIComponent(postId)}`, {
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar comentários.");
    state.comments = payload.comments || [];
    state.commentsError = payload.schemaMissing
      ? "Comentários ainda não estão ativos no banco de dados."
      : "";
  }

  function getCommentImageInput(form) {
    return form?.querySelector("[data-comment-image]") || null;
  }

  function getCommentImageFile(form) {
    return getCommentImageInput(form)?.files?.[0] || null;
  }

  function validateCommentImageFile(file) {
    if (!file) return "";
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type || "")) {
      return "Envie uma imagem JPG, PNG, WebP ou GIF.";
    }
    if (file.size > 5 * 1024 * 1024) {
      return "A imagem do comentário deve ter no máximo 5 MB.";
    }
    return "";
  }

  function setCommentImagePreview(form) {
    const preview = form?.querySelector("[data-comment-image-preview]");
    const file = getCommentImageFile(form);
    if (!preview) return;
    if (!file) {
      preview.hidden = true;
      preview.innerHTML = "";
      return;
    }
    const url = URL.createObjectURL(file);
    preview.hidden = false;
    preview.innerHTML = `
      <img src="${url}" alt="">
      <button type="button" data-comment-image-clear aria-label="Remover imagem">×</button>
    `;
    preview.querySelector("img")?.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  }

  function clearCommentImage(form) {
    const input = getCommentImageInput(form);
    if (input) input.value = "";
    setCommentImagePreview(form);
  }

  async function uploadCommentMedia(form) {
    const file = getCommentImageFile(form);
    if (!file) return null;
    const validationMessage = validateCommentImageFile(file);
    if (validationMessage) throw new Error(validationMessage);
    const formData = new FormData();
    formData.append("target", "comment");
    formData.append("file", file);
    const response = await fetch("/api/post-media-upload", {
      method: "POST",
      headers: {
        authorization: `Bearer ${state.session.access_token}`,
      },
      body: formData,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível enviar a imagem.");
    return {
      url: payload.url,
      key: payload.key,
      mediaType: payload.mediaType,
    };
  }

  function renderCommentEmojiPicker(form) {
    const picker = form?.querySelector("[data-comment-emoji-picker]");
    if (!picker) return null;
    if (!picker.innerHTML) {
      picker.innerHTML = `<emoji-picker class="gimerr-emoji-picker"></emoji-picker>`;
    }
    return picker;
  }

  function toggleCommentEmojiPicker(form) {
    const picker = renderCommentEmojiPicker(form);
    if (!picker) return;
    picker.hidden = !picker.hidden;
  }

  function insertTextInTextarea(textarea, text) {
    if (!textarea || !text) return;
    const value = textarea.value || "";
    const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : value.length;
    const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
    const nextValue = `${value.slice(0, start)}${text}${value.slice(end)}`;
    const maxLength = Number(textarea.maxLength || 0);
    if (maxLength > 0 && nextValue.length > maxLength) return;
    textarea.value = nextValue;
    const cursor = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function submitComment(form) {
    if (!state.session?.access_token || !state.post?.id || state.commentSubmitting) return;
    const parentCommentId = form.dataset.parentCommentId || "";
    const textarea = form.querySelector("textarea");
    const feedback = form.querySelector("[data-comment-feedback], #comment-feedback");
    const body = textarea?.value?.trim() || "";
    const imageFile = getCommentImageFile(form);
    if (!body && !imageFile) {
      textarea?.focus();
      return;
    }

    state.commentSubmitting = true;
    if (feedback) {
      feedback.textContent = "";
      feedback.className = "field-feedback";
    }
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Comentando...";
    }

    try {
      const media = await uploadCommentMedia(form);
      const response = await fetch("/api/posts/comments", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${state.session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          postId: state.post.id,
          parentCommentId: parentCommentId || null,
          body,
          media,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível comentar.");

      state.comments = [...state.comments, payload.comment].filter(Boolean);
      textarea.value = "";
      clearCommentImage(form);
      state.replyingToCommentId = "";
      state.commentSubmitting = false;
      renderPost();
    } catch (error) {
      state.commentSubmitting = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Comentar";
      }
      if (feedback) {
        feedback.textContent = error.message || "Não foi possível comentar.";
        feedback.className = "field-feedback is-error";
      } else {
        window.alert(error.message || "Não foi possível comentar.");
      }
    }
  }

  function removeCommentsFromList(comments, deletedIds) {
    const ids = new Set((deletedIds || []).map(String));
    return (comments || [])
      .filter((comment) => !ids.has(String(comment.id)))
      .map((comment) => (
        ids.has(String(comment.parentCommentId))
          ? {
            ...comment,
            parent: {
              id: comment.parentCommentId,
              status: "deleted",
              body: "",
              author: {},
            },
          }
          : comment
      ));
  }

  async function deleteComment(commentId) {
    if (!state.session?.access_token) return;
    const confirmed = window.confirm("Apagar este comentário?");
    if (!confirmed) return;

    const response = await fetch("/api/posts/comment-delete", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${state.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ commentId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Não foi possível apagar comentário.");

    const deletedIds = payload.deletedCommentIds || [commentId];
    state.comments = removeCommentsFromList(state.comments, deletedIds);
    if (deletedIds.map(String).includes(String(state.replyingToCommentId))) {
      state.replyingToCommentId = "";
    }
    renderPost();
  }

  document.addEventListener("click", async (event) => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    if (!target) return;

    const expandButton = target.closest("[data-expandable-toggle]");
    if (expandButton) {
      event.preventDefault();
      const text = expandButton.previousElementSibling;
      text?.classList.remove("expandable-text");
      text?.removeAttribute("data-expandable-text");
      expandButton.remove();
      return;
    }

    const menuToggle = target.closest("[data-post-menu-toggle]");
    if (menuToggle) {
      event.preventDefault();
      togglePostMenu(menuToggle);
      return;
    }

    const shareButton = target.closest("[data-post-share]");
    if (shareButton) {
      event.preventDefault();
      closePostMenus();
      try {
        await sharePost();
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.warn("Não foi possível compartilhar post.", error);
        window.alert("Não foi possível compartilhar este post.");
      }
      return;
    }

    const listingRecommendationsButton = target.closest("[data-listing-recommendations]");
    if (listingRecommendationsButton) {
      event.preventDefault();
      closePostMenus();
      await openListingRecommendationsModal(listingRecommendationsButton.dataset.sellerId || "");
      return;
    }

    const reportButton = target.closest("[data-post-report]");
    if (reportButton) {
      event.preventDefault();
      closePostMenus();
      try {
        await reportPost(reportButton.dataset.postId);
      } catch (error) {
        console.warn("Não foi possível denunciar post.", error);
        window.alert(error.message || "Não foi possível denunciar este post.");
      }
      return;
    }

    const deleteButton = target.closest("[data-post-delete]");
    if (deleteButton) {
      event.preventDefault();
      closePostMenus();
      try {
        await deletePost(deleteButton.dataset.postId);
      } catch (error) {
        console.warn("Não foi possível apagar post.", error);
        window.alert(error.message || "Não foi possível apagar este post.");
      }
      return;
    }

    const editPostButton = target.closest("[data-post-edit]");
    if (editPostButton) {
      event.preventDefault();
      closePostMenus();
      try {
        await editPostText(editPostButton.dataset.postId || "");
      } catch (error) {
        console.warn("Não foi possível editar post.", error);
        window.alert(error.message || "Não foi possível editar este post.");
      }
      return;
    }

    const editPostCancelButton = target.closest("[data-post-edit-cancel]");
    if (editPostCancelButton) {
      event.preventDefault();
      state.editingPost = false;
      state.editSubmitting = false;
      renderPost();
      return;
    }

    const mentionButton = target.closest("[data-comment-mention-index]");
    if (mentionButton) {
      event.preventDefault();
      const profile = state.commentMention.items[Number(mentionButton.dataset.commentMentionIndex || 0)];
      insertCommentMention(profile);
      return;
    }

    const commentEmojiButton = target.closest("[data-comment-emoji]");
    if (commentEmojiButton) {
      event.preventDefault();
      event.stopPropagation();
      toggleCommentEmojiPicker(commentEmojiButton.closest("[data-comment-form]"));
      return;
    }

    const commentImageClear = target.closest("[data-comment-image-clear]");
    if (commentImageClear) {
      event.preventDefault();
      clearCommentImage(commentImageClear.closest("[data-comment-form]"));
      return;
    }

    const commentDeleteButton = target.closest("[data-comment-delete]");
    if (commentDeleteButton) {
      event.preventDefault();
      try {
        await deleteComment(commentDeleteButton.dataset.commentId || "");
      } catch (error) {
        console.warn("Não foi possível apagar comentário.", error);
        window.alert(error.message || "Não foi possível apagar comentário.");
      }
      return;
    }

    const replyButton = target.closest("[data-comment-reply]");
    if (replyButton) {
      event.preventDefault();
      const commentId = replyButton.dataset.commentId || "";
      state.replyingToCommentId = String(state.replyingToCommentId) === String(commentId) ? "" : commentId;
      renderPost();
      window.setTimeout(() => {
        const textarea = document.querySelector(`[data-parent-comment-id="${CSS.escape(commentId)}"] textarea`);
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
      });
      return;
    }

    const replyCancelButton = target.closest("[data-comment-reply-cancel]");
    if (replyCancelButton) {
      event.preventDefault();
      state.replyingToCommentId = "";
      renderPost();
      return;
    }

    if (!target.closest("[data-post-menu]")) {
      closePostMenus();
    }

    if (!target.closest("[data-comment-emoji-picker]") && !target.closest("[data-comment-emoji]")) {
      document.querySelectorAll("[data-comment-emoji-picker]:not([hidden])").forEach((picker) => {
        picker.hidden = true;
      });
    }

    if (!target.closest("#comment-form")) {
      closeCommentMentionSuggestions();
    }
  });

  document.addEventListener("input", (event) => {
    const textarea = event.target instanceof Element ? event.target.closest("[data-comment-form] textarea") : null;
    if (!textarea) return;
    updateCommentMentionSuggestions(textarea);
  });

  document.addEventListener("change", (event) => {
    const input = event.target instanceof Element ? event.target.closest("[data-comment-image]") : null;
    if (!input) return;
    const form = input.closest("[data-comment-form]");
    const feedback = form?.querySelector("[data-comment-feedback], #comment-feedback");
    const message = validateCommentImageFile(input.files?.[0] || null);
    if (message) {
      if (feedback) {
        feedback.textContent = message;
        feedback.className = "field-feedback is-error";
      }
      clearCommentImage(form);
      return;
    }
    if (feedback) {
      feedback.textContent = "";
      feedback.className = "field-feedback";
    }
    setCommentImagePreview(form);
  });

  document.addEventListener("emoji-click", (event) => {
    const picker = event.target instanceof Element ? event.target.closest("[data-comment-emoji-picker]") : null;
    if (!picker) return;
    const form = picker.closest("[data-comment-form]");
    insertTextInTextarea(form?.querySelector("textarea"), event.detail?.unicode || event.detail?.emoji?.unicode || "");
  });

  document.addEventListener("submit", async (event) => {
    const editForm = event.target instanceof Element ? event.target.closest("[data-post-edit-form]") : null;
    if (editForm) {
      event.preventDefault();
      const postId = editForm.dataset.postId || "";
      const textarea = editForm.querySelector("textarea");
      try {
        await savePostText(postId, textarea?.value || "");
      } catch (error) {
        console.warn("Não foi possível editar post.", error);
        state.editSubmitting = false;
        window.alert(error.message || "Não foi possível editar este post.");
      }
      return;
    }

    const form = event.target instanceof Element ? event.target.closest("[data-comment-form]") : null;
    if (!form) return;
    event.preventDefault();
    await submitComment(form);
  });

  document.addEventListener("keydown", (event) => {
    const textarea = event.target instanceof Element ? event.target.closest("[data-comment-form] textarea") : null;
    if (textarea && state.commentMention.active && state.commentMention.items.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        state.commentMention.selectedIndex = (state.commentMention.selectedIndex + 1) % state.commentMention.items.length;
        renderCommentMentionSuggestions();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        state.commentMention.selectedIndex = (state.commentMention.selectedIndex - 1 + state.commentMention.items.length) % state.commentMention.items.length;
        renderCommentMentionSuggestions();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        insertCommentMention(state.commentMention.items[state.commentMention.selectedIndex]);
        return;
      }
    }

    if (event.key === "Escape") {
      closePostMenus();
      closeCommentMentionSuggestions();
    }
  });

  document.addEventListener("gimerr:video-view", (event) => {
    const postId = event.detail?.postId;
    const videoViewCount = Number(event.detail?.videoViewCount || 0);
    if (!state.post || String(state.post.id) !== String(postId)) return;
    state.post = { ...state.post, videoViewCount };
  });

  async function init() {
    await loadSession().catch((error) => {
      console.warn("Não foi possível carregar sessão.", error);
    });
    if (!state.session?.user) {
      window.location.replace("./sign-in.html");
      return;
    }
    await loadRecommendedProfiles().catch((error) => {
      console.warn("Não foi possível carregar perfis recomendados.", error);
      state.followedProfiles = [];
    });
    await loadPost();
  }

  init();
})();
