(function initGimerrMediaLightbox() {
  const state = {
    backdrop: null,
    image: null,
    avatar: null,
    name: null,
    username: null,
    body: null,
    commentsList: null,
    commentsStatus: null,
    commentsFormSlot: null,
    commentsMoreButton: null,
    closeButton: null,
    previousOverflow: "",
    requestId: 0,
    activePostId: "",
    session: null,
    comments: [],
    hasMore: false,
    nextOffset: 0,
    commentsLoaded: false,
    commentsLoading: false,
    sessionLoading: false,
    commentSubmitting: false,
    replyingToCommentId: "",
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatRelativeTime(value) {
    if (!value) return "";
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    if (!Number.isFinite(diff)) return "";
    const minutes = Math.max(0, Math.floor(diff / 60000));
    if (minutes < 1) return "agora";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} d`;
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }

  function getProfileUrl(author = {}) {
    if (author.username) return `./profile?u=${encodeURIComponent(author.username)}`;
    if (author.id) return `./profile?id=${encodeURIComponent(author.id)}`;
    return "./profile";
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
      if (username && key !== author) {
        output += `<a href="./profile?u=${encodeURIComponent(username)}">@${escapeHtml(username)}</a>`;
      } else {
        output += `@${escapeHtml(username)}`;
      }
      lastIndex = atIndex + username.length + 1;
    }

    output += escapeHtml(value.slice(lastIndex));
    return output;
  }

  function buildCommentsById(comments) {
    return new Map((comments || []).map((comment) => [String(comment.id), comment]));
  }

  function ensureLightbox() {
    if (state.backdrop) return;

    const backdrop = document.createElement("div");
    backdrop.className = "media-lightbox";
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <button class="media-lightbox-close" type="button" aria-label="Fechar imagem">×</button>
      <section class="media-lightbox-panel" role="dialog" aria-modal="true" aria-label="Imagem ampliada">
        <div class="media-lightbox-stage">
          <img class="media-lightbox-image" alt="">
        </div>
        <aside class="media-lightbox-context" aria-label="Informações do post">
          <div class="media-lightbox-author">
            <img class="media-lightbox-avatar" alt="">
            <div>
              <strong class="media-lightbox-name"></strong>
              <span class="media-lightbox-username"></span>
            </div>
          </div>
          <p class="media-lightbox-body"></p>
          <div class="media-lightbox-comments" aria-live="polite">
            <div class="media-lightbox-comments-head">
              <strong>Comentários</strong>
            </div>
            <div class="media-lightbox-comment-form-slot"></div>
            <div class="media-lightbox-comments-list"></div>
            <button class="text-button media-lightbox-comments-more" type="button" hidden>Ver mais comentários</button>
            <p class="media-lightbox-comments-status"></p>
          </div>
        </aside>
      </section>
    `;
    document.body.appendChild(backdrop);

    state.backdrop = backdrop;
    state.image = backdrop.querySelector(".media-lightbox-image");
    state.avatar = backdrop.querySelector(".media-lightbox-avatar");
    state.name = backdrop.querySelector(".media-lightbox-name");
    state.username = backdrop.querySelector(".media-lightbox-username");
    state.body = backdrop.querySelector(".media-lightbox-body");
    state.commentsList = backdrop.querySelector(".media-lightbox-comments-list");
    state.commentsStatus = backdrop.querySelector(".media-lightbox-comments-status");
    state.commentsFormSlot = backdrop.querySelector(".media-lightbox-comment-form-slot");
    state.commentsMoreButton = backdrop.querySelector(".media-lightbox-comments-more");
    state.closeButton = backdrop.querySelector(".media-lightbox-close");

    state.closeButton?.addEventListener("click", closeLightbox);
    state.commentsMoreButton?.addEventListener("click", () => {
      loadComments(state.activePostId, state.requestId, { append: true });
    });
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeLightbox();
    });
    backdrop.addEventListener("submit", (event) => {
      const form = event.target instanceof Element
        ? event.target.closest("[data-lightbox-comment-form]")
        : null;
      if (!form) return;
      event.preventDefault();
      submitComment(form);
    });
    backdrop.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      if (!target) return;
      const replyButton = target.closest("[data-lightbox-comment-reply]");
      if (replyButton) {
        state.replyingToCommentId = replyButton.getAttribute("data-comment-id") || "";
        renderCommentsArea();
        return;
      }
      const cancelReply = target.closest("[data-lightbox-reply-cancel]");
      if (cancelReply) {
        state.replyingToCommentId = "";
        renderCommentsArea();
        return;
      }
      const deleteButton = target.closest("[data-lightbox-comment-delete]");
      if (deleteButton) {
        deleteComment(deleteButton.getAttribute("data-comment-id") || "");
      }
    });
  }

  async function loadSession() {
    if (state.session || !window.GimerrAuth) return state.session;
    const { data } = await window.GimerrAuth.getSession();
    state.session = data.session || null;
    return state.session;
  }

  function getReplyMention(comment) {
    return comment?.author?.username ? `@${comment.author.username} ` : "";
  }

  function renderCommentReplyReference(comment, commentsById) {
    const parentId = comment.parentCommentId || "";
    if (!parentId) return "";
    const localParent = commentsById?.get(String(parentId));
    const parent = localParent
      ? { id: localParent.id, status: "active", author: localParent.author }
      : comment.parent;
    if (!parent || parent.status !== "active") {
      return `<span class="comment-reply-reference is-deleted">Em resposta a comentário excluído</span>`;
    }
    const parentAuthor = parent.author || {};
    const label = parentAuthor.displayName || parentAuthor.username || "comentário";
    return `<a class="comment-reply-reference" href="#lightbox-comment-${escapeHtml(parentId)}">Em resposta a ${escapeHtml(label)}</a>`;
  }

  function renderCommentForm({ parentComment = null } = {}) {
    if (state.sessionLoading) {
      return `<div class="inline-comment-form media-lightbox-comment-form media-lightbox-session-loading">Carregando sessão...</div>`;
    }
    if (!state.session?.access_token) {
      return "";
    }
    const parentId = parentComment?.id || "";
    const isSubmitting = state.commentSubmitting;
    return `
      <form class="inline-comment-form media-lightbox-comment-form" data-lightbox-comment-form data-parent-comment-id="${escapeHtml(parentId)}">
        <textarea maxlength="500" rows="2" placeholder="${parentId ? "Responder comentário" : "Escreva um comentário"}">${parentId ? escapeHtml(getReplyMention(parentComment)) : ""}</textarea>
        <div class="inline-comment-actions">
          ${parentId ? `<button class="text-button" type="button" data-lightbox-reply-cancel>Cancelar</button>` : `<span>Até 500 caracteres.</span>`}
          <button class="primary-button" type="submit" ${isSubmitting ? "disabled" : ""}>
            ${isSubmitting ? "Enviando..." : parentId ? "Responder" : "Comentar"}
          </button>
        </div>
        <p class="field-feedback" data-lightbox-comment-feedback></p>
      </form>
    `;
  }

  function renderComment(comment, commentsById) {
    const author = comment.author || {};
    const authorName = author.displayName || author.username || "Usuário Gimerr";
    const authorHandle = author.username ? `@${author.username}` : "";
    const canDelete = state.session?.user?.id && String(author.id) === String(state.session.user.id);
    const isReplying = String(state.replyingToCommentId) === String(comment.id);
    return `
      <div class="comment-thread">
        <article class="comment-item media-lightbox-comment" id="lightbox-comment-${escapeHtml(comment.id)}">
          <a class="post-avatar" href="${getProfileUrl(author)}">
            <img src="${escapeHtml(author.avatarUrl || "./assets/avatar.svg")}" alt="">
          </a>
          <div class="comment-copy">
            <div class="comment-meta">
              <a href="${getProfileUrl(author)}">${escapeHtml(authorName)}</a>
              <span>${escapeHtml([authorHandle, formatRelativeTime(comment.createdAt)].filter(Boolean).join(" · "))}</span>
            </div>
            ${renderCommentReplyReference(comment, commentsById)}
            <p>${renderTextWithMentions(comment.body, author.username)}</p>
            <div class="comment-actions">
              <button class="text-button comment-reply-button" type="button" data-lightbox-comment-reply data-comment-id="${escapeHtml(comment.id)}">Responder</button>
              ${canDelete ? `
                <button class="comment-delete-button" type="button" data-lightbox-comment-delete data-comment-id="${escapeHtml(comment.id)}" aria-label="Apagar comentário" title="Apagar comentário">
                  <img src="./assets/trash.svg" alt="">
                </button>
              ` : ""}
            </div>
            ${isReplying ? renderCommentForm({ parentComment: comment }) : ""}
          </div>
        </article>
      </div>
    `;
  }

  function renderCommentsArea() {
    if (!state.commentsList || !state.commentsStatus || !state.commentsFormSlot || !state.commentsMoreButton) return;
    state.commentsFormSlot.innerHTML = state.commentsLoaded ? renderCommentForm() : "";

    if (!state.commentsLoaded) {
      state.commentsList.innerHTML = "";
      state.commentsMoreButton.hidden = true;
      return;
    }

    const commentsById = buildCommentsById(state.comments);
    state.commentsList.innerHTML = state.comments.length
      ? state.comments.map((comment) => renderComment(comment, commentsById)).join("")
      : "";
    state.commentsStatus.textContent = state.commentsLoading
      ? "Carregando comentários..."
      : state.comments.length ? "" : "Nenhum comentário ainda.";
    state.commentsMoreButton.hidden = !state.hasMore;
    state.commentsMoreButton.disabled = state.commentsLoading;
    state.commentsMoreButton.textContent = state.commentsLoading ? "Carregando..." : "Ver mais comentários";
  }

  async function loadComments(postId, requestId, { append = false } = {}) {
    if (!state.commentsList || !state.commentsStatus) return;
    if (!postId) {
      state.commentsStatus.textContent = "Comentários indisponíveis.";
      return;
    }

    const offset = append ? Number(state.nextOffset || state.comments.length || 0) : 0;
    state.commentsLoading = true;
    state.sessionLoading = true;
    state.commentsLoaded = true;
    renderCommentsArea();
    await loadSession().catch(() => null);
    state.sessionLoading = false;
    renderCommentsArea();
    try {
      const response = await fetch(`/api/posts/comments?postId=${encodeURIComponent(postId)}&limit=3&offset=${offset}`, {
        headers: { accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar comentários.");
      if (requestId !== state.requestId) return;
      state.comments = append ? [...state.comments, ...(payload.comments || [])] : (payload.comments || []);
      state.hasMore = Boolean(payload.hasMore);
      state.nextOffset = Number(payload.nextOffset || state.comments.length || 0);
      state.replyingToCommentId = "";
    } catch (error) {
      if (requestId !== state.requestId) return;
      state.commentsStatus.textContent = error?.message || "Não foi possível carregar comentários.";
    } finally {
      if (requestId === state.requestId) {
        state.commentsLoading = false;
        renderCommentsArea();
      }
    }
  }

  async function submitComment(form) {
    if (!state.session?.access_token || !state.activePostId || state.commentSubmitting) return;
    const textarea = form.querySelector("textarea");
    const feedback = form.querySelector("[data-lightbox-comment-feedback]");
    const parentCommentId = form.dataset.parentCommentId || "";
    const body = textarea?.value?.trim() || "";
    if (!body) {
      textarea?.focus();
      return;
    }

    state.commentSubmitting = true;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = parentCommentId ? "Respondendo..." : "Comentando...";
    }
    if (feedback) {
      feedback.textContent = "";
      feedback.className = "field-feedback";
    }
    try {
      const response = await fetch("/api/posts/comments", {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${state.session.access_token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          postId: state.activePostId,
          parentCommentId: parentCommentId || null,
          body,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível comentar.");
      state.comments = [...state.comments, payload.comment].filter(Boolean);
      state.nextOffset += 1;
      state.replyingToCommentId = "";
    } catch (error) {
      if (feedback) {
        feedback.textContent = error?.message || "Não foi possível comentar.";
        feedback.className = "field-feedback is-error";
      }
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = parentCommentId ? "Responder" : "Comentar";
      }
      return;
    } finally {
      state.commentSubmitting = false;
    }
    renderCommentsArea();
  }

  function removeDeletedComments(deletedIds) {
    const ids = new Set((deletedIds || []).map(String));
    state.comments = state.comments
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
    if (!state.session?.access_token || !commentId) return;
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
    if (!response.ok) {
      state.commentsStatus.textContent = payload.error || "Não foi possível apagar comentário.";
      return;
    }
    removeDeletedComments(payload.deletedCommentIds || [commentId]);
    if (String(state.replyingToCommentId) === String(commentId)) state.replyingToCommentId = "";
    renderCommentsArea();
  }

  function openLightbox(src, alt = "", meta = {}) {
    if (!src) return;
    ensureLightbox();
    state.requestId += 1;
    const requestId = state.requestId;
    state.image.src = src;
    state.image.alt = alt;
    state.avatar.src = meta.authorAvatar || "./assets/avatar.svg";
    state.avatar.alt = meta.authorName ? `Foto de ${meta.authorName}` : "";
    state.name.textContent = meta.authorName || "Usuário Gimerr";
    state.username.textContent = meta.authorUsername ? `@${meta.authorUsername}` : "";
    state.body.textContent = meta.body || "";
    state.body.hidden = !meta.body;
    state.activePostId = meta.postId || "";
    state.comments = [];
    state.hasMore = false;
    state.nextOffset = 0;
    state.commentsLoaded = false;
    state.commentsLoading = false;
    state.sessionLoading = false;
    state.commentSubmitting = false;
    state.replyingToCommentId = "";
    if (state.commentsList) state.commentsList.innerHTML = "";
    if (state.commentsFormSlot) state.commentsFormSlot.innerHTML = "";
    if (state.commentsMoreButton) state.commentsMoreButton.hidden = true;
    if (state.commentsStatus) {
      state.commentsStatus.textContent = state.activePostId ? "Carregando comentários..." : "Comentários indisponíveis.";
    }
    state.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    state.backdrop.hidden = false;
    state.closeButton?.focus();
    if (state.activePostId) loadComments(state.activePostId, requestId);
  }

  function closeLightbox() {
    if (!state.backdrop || state.backdrop.hidden) return;
    state.requestId += 1;
    state.backdrop.hidden = true;
    state.image.removeAttribute("src");
    state.avatar.removeAttribute("src");
    document.body.style.overflow = state.previousOverflow;
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target instanceof Element
      ? event.target.closest("[data-image-lightbox]")
      : null;
    if (!trigger) return;
    event.preventDefault();
    openLightbox(trigger.getAttribute("data-image-src"), trigger.getAttribute("data-image-alt") || "", {
      authorName: trigger.getAttribute("data-image-author-name") || "",
      authorUsername: trigger.getAttribute("data-image-author-username") || "",
      authorAvatar: trigger.getAttribute("data-image-author-avatar") || "",
      body: trigger.getAttribute("data-image-body") || "",
      postId: trigger.getAttribute("data-image-post-id") || "",
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeLightbox();
  });
}());
