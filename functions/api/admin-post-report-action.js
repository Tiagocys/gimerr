import { deleteR2Object, getSupabaseRestUrl, jsonResponse } from "../_shared/auth.js";
import { getServiceHeaders, requireAdminUser } from "../_shared/admin.js";

const ACTIONS = new Set(["suspend_7_days", "delete_post", "ban_user", "ignore"]);

function cleanText(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function fetchRows(env, table, select, filters = {}) {
  const url = new URL(`${getSupabaseRestUrl(env)}/${table}`);
  url.searchParams.set("select", select);
  Object.entries(filters).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar dados de moderação.");
  return rows;
}

async function patchRows(env, table, filters, body) {
  const url = new URL(`${getSupabaseRestUrl(env)}/${table}`);
  Object.entries(filters).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, { prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível salvar moderação.");
  return rows;
}

async function createNotification(env, recipientId, type, title, body, data = {}) {
  if (!recipientId) return;
  const response = await fetch(`${getSupabaseRestUrl(env)}/notifications`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "return=minimal" }),
    body: JSON.stringify({
      recipient_id: recipientId,
      sender_name: "Gimerr",
      sender_avatar_url: "/assets/favicon.png",
      type,
      title,
      body,
      action_url: null,
      data,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível criar notificação de moderação.");
  }
}

function collectPostMediaKeys(post) {
  const ownerId = post?.profile_id;
  return [...new Set([
    post?.media_key,
    post?.original_media_key,
    post?.ready_media_key,
    post?.video_thumbnail_key,
  ].filter((key) => {
    if (!key) return false;
    return key.startsWith("posts/")
      || key.startsWith("market/")
      || key.startsWith("videos/originals/")
      || key.startsWith("videos/ready/")
      || key.startsWith("videos/thumbnails/")
      || (ownerId && key.startsWith(`videos/${ownerId}/`));
  }))];
}

async function deleteReportedPost(env, post) {
  const results = await Promise.allSettled(collectPostMediaKeys(post).map((key) => deleteR2Object(env, key)));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason || new Error("Não foi possível remover mídia do post.");

  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("id", `eq.${post.id}`);
  const response = await fetch(url.toString(), { method: "DELETE", headers: getServiceHeaders(env) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Não foi possível excluir o post.");
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const admin = await requireAdminUser(request, env);
    if (admin.error) return admin.error;

    const payload = await request.json().catch(() => ({}));
    const reportId = cleanText(payload.reportId, 80);
    const action = cleanText(payload.action, 40);
    const note = cleanText(payload.note, 800) || null;
    if (!reportId || !ACTIONS.has(action)) {
      return jsonResponse({ error: "Ação de moderação inválida." }, { status: 400 });
    }

    const [report] = await fetchRows(env, "post_reports", "id,post_id,reporter_id,status,reported_profile_id", {
      id: `eq.${reportId}`,
      limit: "1",
    });
    if (!report) return jsonResponse({ error: "Denúncia não encontrada." }, { status: 404 });
    if (report.status !== "pending") return jsonResponse({ error: "Esta denúncia já foi analisada." }, { status: 409 });

    const [post] = report.post_id
      ? await fetchRows(env, "feed_posts", "id,profile_id,media_key,original_media_key,ready_media_key,video_thumbnail_key", { id: `eq.${report.post_id}`, limit: "1" })
      : [];
    const targetUserId = post?.profile_id || report.reported_profile_id;
    const [targetUser] = targetUserId
      ? await fetchRows(env, "profiles", "id,display_name,username,status,is_admin", { id: `eq.${targetUserId}`, limit: "1" })
      : [];

    if (action !== "ignore" && !targetUser) {
      return jsonResponse({ error: "O usuário denunciado não está mais disponível." }, { status: 404 });
    }
    if (action !== "ignore" && Number(targetUser?.is_admin || 0) === 1) {
      return jsonResponse({ error: "Uma conta administradora não pode ser moderada por esta ação." }, { status: 403 });
    }

    const now = new Date();
    let resolution = "ignored";
    let affectedReportIds = [report.id];

    if (action === "suspend_7_days") {
      const suspendedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      await patchRows(env, "profiles", { id: `eq.${targetUser.id}` }, {
        status: "suspended",
        suspended_until: suspendedUntil.toISOString(),
        moderation_reason: note || "Suspensão aplicada após análise de denúncia.",
        moderated_at: now.toISOString(),
        moderated_by: admin.user.id,
      });
      await createNotification(
        env,
        targetUser.id,
        "account_suspended",
        "Conta suspensa por 7 dias",
        `Sua conta foi suspensa até ${suspendedUntil.toLocaleDateString("pt-BR")} após uma análise da moderação do Gimerr.`,
        { suspendedUntil: suspendedUntil.toISOString(), reportId },
      );
      resolution = "suspended_7_days";
    } else if (action === "delete_post") {
      if (!post) return jsonResponse({ error: "Este post já foi excluído." }, { status: 409 });
      const relatedReports = await fetchRows(env, "post_reports", "id", { post_id: `eq.${post.id}`, status: "eq.pending" });
      affectedReportIds = relatedReports.map((item) => item.id);
      await deleteReportedPost(env, post);
      await createNotification(
        env,
        targetUser.id,
        "post_removed_by_moderation",
        "Publicação removida",
        "Uma publicação sua foi removida após análise da moderação do Gimerr.",
        { reportId },
      );
      resolution = "post_deleted";
    } else if (action === "ban_user") {
      await patchRows(env, "profiles", { id: `eq.${targetUser.id}` }, {
        status: "banned",
        suspended_until: null,
        moderation_reason: note || "Banimento aplicado após análise de denúncia.",
        moderated_at: now.toISOString(),
        moderated_by: admin.user.id,
      });
      await createNotification(
        env,
        targetUser.id,
        "account_banned",
        "Conta banida permanentemente",
        "Sua conta foi banida permanentemente após uma análise da moderação do Gimerr.",
        { reportId },
      );
      resolution = "user_banned";
    } else {
      await createNotification(
        env,
        report.reporter_id,
        "report_reviewed",
        "Denúncia analisada",
        "A moderação analisou sua denúncia e decidiu não aplicar uma ação ao conteúdo reportado.",
        { reportId },
      );
    }

    const reportFilter = affectedReportIds.length === 1
      ? `eq.${affectedReportIds[0]}`
      : `in.(${affectedReportIds.join(",")})`;
    const updated = await patchRows(env, "post_reports", { id: reportFilter }, {
      status: "resolved",
      resolution,
      resolution_note: note,
      reviewed_at: now.toISOString(),
      reviewed_by: admin.user.id,
    });

    return jsonResponse({ ok: true, reports: updated, resolution });
  } catch (error) {
    console.error("admin post report action failed", error);
    return jsonResponse({ error: error?.message || "Falha ao aplicar moderação." }, { status: 500 });
  }
}
