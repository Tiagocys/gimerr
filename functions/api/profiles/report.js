import { getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../../_shared/auth.js";
import { getServiceHeaders } from "../../_shared/admin.js";
import { createAdminTicket } from "../../_shared/admin-tickets.js";
import { appendReportAttachments, normalizeReportFiles } from "../../_shared/report-attachments.js";
import { getProfileVerification, isDiscordBotVerifiedProfile } from "../../_shared/verification.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function fetchProfile(env, profileId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,display_name,username,avatar_url,status");
  url.searchParams.set("id", `eq.${profileId}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar o perfil.");
  return rows[0] || null;
}

async function fetchExistingReport(env, profileId, reporterId) {
  const url = new URL(`${getSupabaseRestUrl(env)}/profile_reports`);
  url.searchParams.set("select", "id,status,created_at");
  url.searchParams.set("reported_profile_id", `eq.${profileId}`);
  url.searchParams.set("reporter_id", `eq.${reporterId}`);
  url.searchParams.set("limit", "1");
  const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível validar denúncia existente.");
  return rows[0] || null;
}

async function createProfileReport(env, payload) {
  const response = await fetch(`${getSupabaseRestUrl(env)}/profile_reports?on_conflict=reported_profile_id,reporter_id`, {
    method: "POST",
    headers: getServiceHeaders(env, { prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(payload),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível registrar a denúncia.");
  return rows[0] || null;
}

async function readReportPayload(request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const files = normalizeReportFiles(formData.getAll("attachments"));
    return {
      payload: {
        profileId: formData.get("profileId"),
        reason: formData.get("reason"),
      },
      files,
    };
  }
  return {
    payload: await request.json().catch(() => ({})),
    files: [],
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const { payload, files } = await readReportPayload(request);
    const profileId = cleanText(payload.profileId, 80);
    const reason = cleanText(payload.reason, 500);
    if (!profileId) return jsonResponse({ error: "Perfil ausente." }, { status: 400 });
    if (profileId === auth.user.id) return jsonResponse({ error: "Você não pode denunciar seu próprio perfil." }, { status: 400 });
    if (reason.length < 3) return jsonResponse({ error: "Informe o motivo da denúncia." }, { status: 400 });

    const reporterProfile = await getProfileVerification(env, auth.user.id);
    if (!isDiscordBotVerifiedProfile(reporterProfile)) {
      return jsonResponse({
        error: "Apenas contas verificadas pelo Discord do Gimerr podem enviar denúncias.",
        code: "report_requires_discord_verification",
      }, { status: 403 });
    }

    const target = await fetchProfile(env, profileId);
    if (!target || target.status === "deleted") {
      return jsonResponse({ error: "Perfil não encontrado." }, { status: 404 });
    }

    const existingReport = await fetchExistingReport(env, profileId, auth.user.id);
    if (existingReport) {
      return jsonResponse({
        error: "Você já enviou uma denúncia para este perfil.",
        code: "duplicate_report",
        report: existingReport,
      }, { status: 409 });
    }

    const report = await createProfileReport(env, {
      reported_profile_id: profileId,
      reporter_id: auth.user.id,
      reason,
      status: "pending",
      resolution: null,
      resolution_note: null,
      reviewed_at: null,
      reviewed_by: null,
      reported_display_name: target.display_name,
      reported_username: target.username,
      reported_avatar_url: target.avatar_url,
      created_at: new Date().toISOString(),
    });

    if (report?.id) {
      const targetLabel = target.username ? `@${target.username}` : target.display_name || "perfil denunciado";
      const ticketResult = await createAdminTicket(env, {
        sourceType: "profile_report",
        sourceId: report.id,
        requesterId: auth.user.id,
        title: "Denúncia de perfil",
        initialMessage: [
          "Recebemos sua denúncia e ela será analisada pela equipe do Gimerr.",
          `Perfil denunciado: ${targetLabel}`,
          `Motivo informado: ${reason}`,
          "Aguarde uma resposta da equipe antes de complementar este caso.",
        ].join("\n\n"),
      });
      if (ticketResult?.conversationId && files.length) {
        await appendReportAttachments(env, {
          conversationId: ticketResult.conversationId,
          senderId: auth.user.id,
          files,
        });
      }
    }

    return jsonResponse({ ok: true, report });
  } catch (error) {
    console.error("profile report failed", error);
    return jsonResponse({ error: error?.message || "Falha ao denunciar perfil." }, { status: 500 });
  }
}
