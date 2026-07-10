const profileInfo = {
  id: "",
  displayName: "",
  username: "",
  phone: "",
  phoneVisibility: "private",
  phoneContactWhatsapp: false,
  phoneContactTelegram: false,
  connectedAccounts: [],
};

const state = {
  session: null,
  loading: true,
  following: false,
  recommended: false,
  followerCount: 0,
  recommendationCount: 0,
  postsCount: 0,
  followers: [],
  recommendations: [],
  posts: [],
  profileMissing: false,
};

const els = {
  layout: document.querySelector("#profile-layout"),
  search: document.querySelector("#profile-search"),
  feedList: document.querySelector("#profile-feed-list"),
  displayName: document.querySelector("#profile-display-name"),
  avatar: document.querySelector(".profile-avatar-large"),
  followButton: document.querySelector("#follow-button"),
  recommendButton: document.querySelector("#recommend-button"),
  followersButton: document.querySelector("#followers-button"),
  recommendationsButton: document.querySelector("#recommendations-button"),
  followersCount: document.querySelector("#followers-count"),
  recommendationsCount: document.querySelector("#recommendations-count"),
  postsCount: document.querySelector("#posts-count"),
  publicInfo: document.querySelector("#profile-public-info"),
  peopleModal: document.querySelector("#people-modal"),
  peopleModalTitle: document.querySelector("#people-modal-title"),
  peopleModalClose: document.querySelector("#people-modal-close"),
  peopleList: document.querySelector("#people-list"),
  editProfileLink: document.querySelector("#edit-profile-link"),
  feedSubtitle: document.querySelector("#profile-feed-subtitle"),
};

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getProfileTarget() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id")?.trim();
  const username = (params.get("u") || params.get("username"))?.trim().replace(/^@/, "");

  if (id) return { type: "id", value: id };
  if (username) return { type: "username", value: username };
  return null;
}

function getPublicProfileUrl(profile) {
  if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
  return `./profile?id=${encodeURIComponent(profile.id)}`;
}

function getProfileUrl(profile) {
  if (profile?.username) return `./profile?u=${encodeURIComponent(profile.username)}`;
  return `./profile?id=${encodeURIComponent(profile.id || profile.follower_id || profile.recommender_id)}`;
}

function isPhoneContactSchemaError(error) {
  return /phone_contact_(whatsapp|telegram)/i.test(error?.message || "");
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "agora";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `há ${days} d`;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function profilePostTypeLabel(type) {
  if (type === "video") return "Vídeo";
  if (type === "listing") return "Anúncio";
  return "Imagem";
}

function applyProfile(profile, links = []) {
  if (!profile) return;

  state.profileMissing = false;
  const displayName = profile.display_name || profile.username || "Usuário Gimerr";
  profileInfo.id = profile.id;
  profileInfo.displayName = displayName;
  profileInfo.username = profile.username || "";
  profileInfo.phone = profile.phone_e164 || "";
  profileInfo.phoneVisibility = profile.phone_e164 ? "public" : "private";
  profileInfo.phoneContactWhatsapp = Boolean(profile.phone_contact_whatsapp);
  profileInfo.phoneContactTelegram = Boolean(profile.phone_contact_telegram);
  profileInfo.connectedAccounts = links.map((link) => ({
    platform: link.platform,
    handle: link.handle || link.platform,
    profileUrl: link.profile_url,
    externalUserId: link.external_user_id,
  }));

  document.title = `${displayName} | Gimerr`;
  els.displayName.textContent = displayName;

  if (profile.avatar_url) {
    els.avatar.innerHTML = `<img src="${escapeHtml(profile.avatar_url)}" alt="">`;
  } else {
    els.avatar.innerHTML = `<img src="./assets/avatar.svg" alt="">`;
  }

  els.feedSubtitle.textContent = `Conteúdo publicado por ${displayName}.`;
}

async function loadProfileStats(client, profileId, viewerId) {
  const [
    statsResult,
    followersResult,
    recommendationsResult,
    followingResult,
    recommendedResult,
  ] = await Promise.all([
    client
      .from("public_profile_stats")
      .select("followers_count, recommendations_count, posts_count")
      .eq("profile_id", profileId)
      .maybeSingle(),
    client
      .from("public_profile_followers")
      .select("follower_id, display_name, username, avatar_url")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(50),
    client
      .from("public_profile_recommenders")
      .select("recommender_id, display_name, username, avatar_url")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(50),
    viewerId && viewerId !== profileId
      ? client
        .from("user_follows")
        .select("follower_id")
        .eq("follower_id", viewerId)
        .eq("following_id", profileId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    viewerId && viewerId !== profileId
      ? client
        .from("profile_recommendations")
        .select("recommender_id")
        .eq("recommender_id", viewerId)
        .eq("recommended_id", profileId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (statsResult.error) throw statsResult.error;
  if (followersResult.error) throw followersResult.error;
  if (recommendationsResult.error) throw recommendationsResult.error;
  if (followingResult.error && followingResult.error.code !== "PGRST116") throw followingResult.error;
  if (recommendedResult.error && recommendedResult.error.code !== "PGRST116") throw recommendedResult.error;

  state.followerCount = Number(statsResult.data?.followers_count || 0);
  state.recommendationCount = Number(statsResult.data?.recommendations_count || 0);
  state.followers = followersResult.data || [];
  state.recommendations = recommendationsResult.data || [];
  state.following = Boolean(followingResult.data);
  state.recommended = Boolean(recommendedResult.data);
}

async function loadProfilePosts(client, profileId) {
  const { data, error, count } = await client
    .from("public_feed_posts")
    .select("id, profile_id, game_igdb_id, post_type, body, media_url, media_type, video_status, video_thumbnail_url, processing_error, created_at, game_name, game_slug", { count: "exact" })
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  state.posts = (data || []).map((post) => ({
    id: post.id,
    profileId: post.profile_id,
    type: post.post_type,
    body: post.body || "",
    mediaUrl: post.media_url || "",
    mediaType: post.media_type || "",
    videoStatus: post.video_status || "none",
    videoThumbnailUrl: post.video_thumbnail_url || "",
    processingError: post.processing_error || "",
    createdAt: post.created_at,
    gameId: post.game_igdb_id,
    gameName: post.game_name || "Game",
    gameSlug: post.game_slug || "",
  }));
  state.postsCount = Number(count ?? state.posts.length);
}

async function hydrateAuthenticatedProfile() {
  try {
    const client = await window.GimerrAuth.getClient();
    const { data } = await window.GimerrAuth.getSession();
    const user = data.session?.user;
    const target = getProfileTarget();
    state.session = data.session || null;

    if (!target && !user) {
      window.location.replace("./sign-in.html");
      return;
    }

    let query = client
      .from("public_profiles")
      .select("id, display_name, username, phone_e164, phone_contact_whatsapp, phone_contact_telegram, avatar_url");

    if (target?.type === "username") {
      query = query.eq("username", target.value);
    } else {
      query = query.eq("id", target?.value || user.id);
    }

    let profileResult = await query.maybeSingle();

    if (isPhoneContactSchemaError(profileResult.error)) {
      let fallbackQuery = client
        .from("public_profiles")
        .select("id, display_name, username, phone_e164, avatar_url");

      if (target?.type === "username") {
        fallbackQuery = fallbackQuery.eq("username", target.value);
      } else {
        fallbackQuery = fallbackQuery.eq("id", target?.value || user.id);
      }

      profileResult = await fallbackQuery.maybeSingle();
    }

    if (profileResult.error) throw profileResult.error;

    if (!profileResult.data) {
      state.profileMissing = true;
      state.loading = false;
      els.layout.classList.remove("is-loading");
      els.displayName.textContent = "Perfil não encontrado";
      els.publicInfo.innerHTML = `<span class="profile-handle">Este usuário ainda não existe no Gimerr.</span>`;
      els.feedList.innerHTML = `<div class="post-card empty-state">Nada novo por aqui.</div>`;
      els.editProfileLink.hidden = true;
      els.followButton.hidden = true;
      els.recommendButton.hidden = true;
      return;
    }

    const { data: links, error: linksError } = await client
      .from("public_profile_platform_links")
      .select("platform, handle, profile_url, external_user_id")
      .eq("profile_id", profileResult.data.id);

    if (linksError) throw linksError;

    await Promise.all([
      loadProfileStats(client, profileResult.data.id, user?.id),
      loadProfilePosts(client, profileResult.data.id),
    ]);
    applyProfile(profileResult.data, links || []);

    const isOwnProfile = profileResult.data.id === user?.id;
    els.editProfileLink.hidden = !isOwnProfile;
    els.followButton.hidden = isOwnProfile;
    els.recommendButton.hidden = isOwnProfile;

    if (isOwnProfile) {
      window.history.replaceState({}, document.title, getPublicProfileUrl(profileResult.data));
    }
  } catch (error) {
    console.warn("Não foi possível carregar perfil.", error);
    state.loading = false;
    els.layout.classList.remove("is-loading");
    els.displayName.textContent = "Não foi possível carregar o perfil";
    els.feedList.innerHTML = `<div class="post-card empty-state">Tente novamente em instantes.</div>`;
  }
}

function renderCounts() {
  if (state.loading) return;
  els.followersCount.textContent = String(state.followerCount);
  els.recommendationsCount.textContent = String(state.recommendationCount);
  els.postsCount.textContent = String(state.postsCount);
}

function renderActions() {
  if (state.loading) return;
  if (state.profileMissing) return;
  els.followButton.disabled = !state.session?.user || !profileInfo.id;
  els.recommendButton.disabled = !state.session?.user || !profileInfo.id;
  els.followButton.textContent = state.following ? "Seguindo" : "Seguir";
  els.followButton.classList.toggle("is-secondary-state", state.following);
  els.recommendButton.textContent = state.recommended ? "Recomendado" : "Recomendar";
  els.recommendButton.classList.toggle("is-secondary-state", state.recommended);
}

function renderPublicInfo() {
  if (state.loading) return;
  if (state.profileMissing) return;
  const phoneDigits = profileInfo.phone.replace(/\D/g, "");
  const phoneItem = profileInfo.phoneVisibility === "public" && profileInfo.phone
    ? `<a class="info-pill" href="tel:${escapeHtml(profileInfo.phone.replace(/\s/g, ""))}">${escapeHtml(profileInfo.phone)}</a>`
    : "";
  const whatsappItem = profileInfo.phoneVisibility === "public" && profileInfo.phoneContactWhatsapp && phoneDigits
    ? `<a class="info-pill contact-pill" href="https://wa.me/${escapeHtml(phoneDigits)}" target="_blank" rel="noopener">
        <img src="./assets/wtsp.png" alt="">
        WhatsApp
      </a>`
    : "";
  const telegramItem = profileInfo.phoneVisibility === "public" && profileInfo.phoneContactTelegram && phoneDigits
    ? `<a class="info-pill contact-pill" href="tg://resolve?phone=${escapeHtml(phoneDigits)}">
        <img src="./assets/telegram.webp" alt="">
        Telegram
      </a>`
    : "";

  const accountItems = profileInfo.connectedAccounts.map((account) => {
    const platform = String(account.platform || "");
    const lowerPlatform = platform.toLowerCase();
    const handle = account.handle?.startsWith("@") ? account.handle : `@${account.handle || platform}`;
    const profileUrl = lowerPlatform === "discord" && account.externalUserId
      ? `discord://-/users/${account.externalUserId}`
      : account.profileUrl;
    const tag = profileUrl ? "a" : "span";
    const attrs = profileUrl
      ? `href="${escapeHtml(profileUrl)}" ${lowerPlatform === "discord" ? "" : 'target="_blank" rel="noopener"'}`
      : "";

    return `
      <${tag} class="info-pill platform-pill" ${attrs}>
        <strong>${escapeHtml(account.platform)}</strong>
        ${escapeHtml(handle)}
      </${tag}>
    `;
  }).join("");

  els.publicInfo.innerHTML = `
    ${profileInfo.username ? `<span class="profile-handle">@${escapeHtml(profileInfo.username)}</span>` : ""}
    <div class="profile-info-list">
      ${phoneItem}
      ${whatsappItem}
      ${telegramItem}
      ${accountItems}
    </div>
  `;
}

function renderPostMenu(post) {
  const postId = escapeHtml(post.id);
  const isOwner = state.session?.user?.id && post.profileId === state.session.user.id;
  return `
    <div class="post-menu" data-post-menu>
      <button class="ghost-icon post-menu-button" type="button" data-post-menu-toggle data-post-id="${postId}" aria-label="Abrir menu do post" aria-expanded="false">
        <span aria-hidden="true">&#8942;</span>
      </button>
      <div class="post-menu-popover" hidden>
        <button type="button" data-post-share data-post-id="${postId}">Compartilhar</button>
        ${!isOwner ? `<button type="button" data-post-report data-post-id="${postId}">Denunciar</button>` : ""}
        ${isOwner ? `<button class="danger" type="button" data-post-delete data-post-id="${postId}">Apagar post</button>` : ""}
      </div>
    </div>
  `;
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

function getPostShareUrl(postId) {
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.set("post", postId);
  return url.toString();
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

async function sharePost(postId) {
  const url = getPostShareUrl(postId);
  const post = state.posts.find((item) => String(item.id) === String(postId));
  const title = post?.type === "video"
    ? `Veja este vídeo no Gimerr`
    : `Veja este post no Gimerr`;

  if (navigator.share) {
    await navigator.share({
      title,
      text: `Publicado em ${post?.gameName || "Gimerr"}`,
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

  const reason = window.prompt("Informe o motivo da denúncia. Você pode deixar em branco.");
  if (reason === null) return;

  const response = await fetch("/api/posts/report", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${state.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ postId, reason }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Não foi possível denunciar este post.");
  window.alert("Denúncia enviada.");
}

async function deletePost(postId) {
  if (!state.session?.access_token) return;
  const confirmed = window.confirm("Apagar este post? Essa ação também remove a mídia enviada.");
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

  state.posts = state.posts.filter((post) => String(post.id) !== String(postId));
  state.postsCount = Math.max(0, state.postsCount - 1);
  renderCounts();
  renderFeed();
}

function renderFeed() {
  if (state.loading) return;
  if (state.profileMissing) return;
  const query = els.search.value.trim().toLowerCase();
  const filtered = state.posts.filter((post) => !query || [
    post.body,
    post.type,
    post.gameName,
  ].join(" ").toLowerCase().includes(query));

  if (!filtered.length) {
    els.feedList.innerHTML = `<div class="post-card empty-state">Nada novo por aqui.</div>`;
    return;
  }

  els.feedList.innerHTML = filtered.map((post) => {
    const typeLabel = profilePostTypeLabel(post.type);
    const media = post.mediaUrl
      ? post.mediaType.startsWith("video/")
        ? `<video class="media-frame" src="${escapeHtml(post.mediaUrl)}" ${post.videoThumbnailUrl ? `poster="${escapeHtml(post.videoThumbnailUrl)}"` : ""} controls playsinline preload="metadata"></video>`
        : `<img class="media-frame" src="${escapeHtml(post.mediaUrl)}" alt="">`
      : "";
    const gameUrl = post.gameSlug
      ? `./game?slug=${encodeURIComponent(post.gameSlug)}`
      : `./game?id=${encodeURIComponent(post.gameId)}`;
    return `
      <article class="post-card">
        ${media}
        <div class="post-body">
          <div class="post-meta">
            <span>${escapeHtml(formatRelativeTime(post.createdAt))}</span>
            <div class="post-card-tools">
              ${renderPostMenu(post)}
            </div>
          </div>
          <div>
            <h3 class="post-title">${escapeHtml(typeLabel)}</h3>
            ${post.body ? `<p class="post-text">${escapeHtml(post.body)}</p>` : ""}
          </div>
          <a class="channel-line" href="${gameUrl}">
            <span class="channel-dot" aria-hidden="true"></span>
            <span>${escapeHtml(post.gameName)}</span>
          </a>
        </div>
      </article>
    `;
  }).join("");
}

function renderPersonAvatar(user) {
  if (user.avatar_url) {
    return `<img src="${escapeHtml(user.avatar_url)}" alt="">`;
  }
  return `<img src="./assets/avatar.svg" alt="">`;
}

function openPeopleModal(title, users) {
  els.peopleModalTitle.textContent = title;
  if (!users.length) {
    els.peopleList.innerHTML = `<div class="empty-state">Nenhum usuário por aqui.</div>`;
  } else {
    els.peopleList.innerHTML = users.map((user) => `
      <a class="people-row" href="${getProfileUrl(user)}">
        <div class="post-avatar">${renderPersonAvatar(user)}</div>
        <div>
          <strong>${escapeHtml(user.display_name || user.username || "Usuário Gimerr")}</strong>
          ${user.username ? `<span>@${escapeHtml(user.username)}</span>` : ""}
        </div>
      </a>
    `).join("");
  }
  els.peopleModal.hidden = false;
  els.peopleModalClose.focus();
}

function closePeopleModal() {
  els.peopleModal.hidden = true;
}

async function toggleFollow() {
  if (!state.session?.user || !profileInfo.id) {
    window.location.assign("./sign-in.html");
    return;
  }

  const client = await window.GimerrAuth.getClient();
  const nextFollowing = !state.following;
  els.followButton.disabled = true;
  els.followButton.textContent = nextFollowing ? "Seguindo..." : "Removendo...";

  try {
    if (nextFollowing) {
      const { error } = await client
        .from("user_follows")
        .upsert({
          follower_id: state.session.user.id,
          following_id: profileInfo.id,
        }, { onConflict: "follower_id,following_id", ignoreDuplicates: true });
      if (error) throw error;
    } else {
      const { error } = await client
        .from("user_follows")
        .delete()
        .eq("follower_id", state.session.user.id)
        .eq("following_id", profileInfo.id);
      if (error) throw error;
    }

    await loadProfileStats(client, profileInfo.id, state.session.user.id);
    renderCounts();
    renderActions();
  } catch (error) {
    console.warn("Não foi possível atualizar seguidor.", error);
    renderActions();
  }
}

async function toggleRecommendation() {
  if (!state.session?.user || !profileInfo.id) {
    window.location.assign("./sign-in.html");
    return;
  }

  const client = await window.GimerrAuth.getClient();
  const nextRecommended = !state.recommended;
  els.recommendButton.disabled = true;
  els.recommendButton.textContent = nextRecommended ? "Recomendando..." : "Removendo...";

  try {
    if (nextRecommended) {
      const { error } = await client
        .from("profile_recommendations")
        .upsert({
          recommender_id: state.session.user.id,
          recommended_id: profileInfo.id,
        }, { onConflict: "recommender_id,recommended_id", ignoreDuplicates: true });
      if (error) throw error;
    } else {
      const { error } = await client
        .from("profile_recommendations")
        .delete()
        .eq("recommender_id", state.session.user.id)
        .eq("recommended_id", profileInfo.id);
      if (error) throw error;
    }

    await loadProfileStats(client, profileInfo.id, state.session.user.id);
    renderCounts();
    renderActions();
  } catch (error) {
    console.warn("Não foi possível atualizar recomendação.", error);
    renderActions();
  }
}

els.search.addEventListener("input", renderFeed);
els.followButton.addEventListener("click", toggleFollow);
els.recommendButton.addEventListener("click", toggleRecommendation);
els.followersButton.addEventListener("click", () => openPeopleModal("Seguidores", state.followers));
els.recommendationsButton.addEventListener("click", () => openPeopleModal("Recomendações", state.recommendations));
els.peopleModalClose.addEventListener("click", closePeopleModal);

els.peopleModal.addEventListener("click", (event) => {
  if (event.target === els.peopleModal) closePeopleModal();
});

document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!target) return;

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
      await sharePost(shareButton.dataset.postId);
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Não foi possível compartilhar post.", error);
      window.alert("Não foi possível compartilhar este post.");
    }
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

  if (!target.closest("[data-post-menu]")) {
    closePostMenus();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!els.peopleModal.hidden) closePeopleModal();
    closePostMenus();
  }
});

async function init() {
  els.followButton.disabled = true;
  els.recommendButton.disabled = true;
  await hydrateAuthenticatedProfile();
  state.loading = false;
  els.layout.classList.remove("is-loading");
  renderCounts();
  renderActions();
  renderPublicInfo();
  renderFeed();
}

init();
