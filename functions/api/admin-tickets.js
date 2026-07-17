import { jsonResponse } from "../_shared/auth.js";
import { requireAdminUser } from "../_shared/admin.js";
import { fetchRows, inFilter, toProfile } from "../_shared/messages.js";

function cleanStatus(value) {
  return new Set(["open", "reopened", "resolved", "closed", "all"]).has(value) ? value : "open";
}

function sourceLabel(ticket, source) {
  if (ticket.source_type === "post_report") return "Denúncia de anúncio";
  if (ticket.source_type === "profile_report") return "Denúncia de perfil";
  if (ticket.source_type === "game_submission") {
    return source?.name ? `Cadastro de jogo: ${source.name}` : "Solicitação de cadastro de jogo";
  }
  return ticket.title || "Caso Gimerr";
}

export async function onRequestGet({ request, env }) {
  try {
    const admin = await requireAdminUser(request, env);
    if (admin.error) return admin.error;

    const requestUrl = new URL(request.url);
    const status = cleanStatus(requestUrl.searchParams.get("status") || "open");

    const params = {
      select: "id,conversation_id,source_type,source_id,requester_id,title,status,reopenable,user_can_reply,closed_at,closed_by,created_at,updated_at",
      order: "updated_at.desc",
      limit: "100",
    };
    if (status !== "all") params.status = `eq.${status}`;

    const tickets = await fetchRows(env, "admin_tickets", params);
    if (!tickets.length) return jsonResponse({ tickets: [] });

    const requesterIds = tickets.map((ticket) => ticket.requester_id).filter(Boolean);
    const conversationIds = tickets.map((ticket) => ticket.conversation_id).filter(Boolean);
    const postReportIds = tickets.filter((ticket) => ticket.source_type === "post_report").map((ticket) => ticket.source_id);
    const profileReportIds = tickets.filter((ticket) => ticket.source_type === "profile_report").map((ticket) => ticket.source_id);
    const gameSubmissionIds = tickets.filter((ticket) => ticket.source_type === "game_submission").map((ticket) => ticket.source_id);

    const [profiles, latestMessages, postReports, profileReports, gameSubmissions] = await Promise.all([
      requesterIds.length
        ? fetchRows(env, "profiles", {
          select: "id,display_name,username,avatar_url,status",
          id: inFilter(requesterIds),
        })
        : [],
      conversationIds.length
        ? fetchRows(env, "conversation_messages", {
          select: "id,conversation_id,sender_id,body,media_url,media_type,created_at",
          conversation_id: inFilter(conversationIds),
          status: "eq.active",
          order: "created_at.desc",
          limit: "300",
        })
        : [],
      postReportIds.length
        ? fetchRows(env, "post_reports", {
          select: "id,reason,status,resolution,created_at,post_id,reported_profile_id,reported_post_type,reported_post_body,reported_media_url,reported_media_type,reported_video_thumbnail_url",
          id: inFilter(postReportIds),
        })
        : [],
      profileReportIds.length
        ? fetchRows(env, "profile_reports", {
          select: "id,reason,status,resolution,created_at,reported_profile_id,reported_display_name,reported_username,reported_avatar_url",
          id: inFilter(profileReportIds),
        })
        : [],
      gameSubmissionIds.length
        ? fetchRows(env, "game_submission_requests", {
          select: "id,name,status,review_notes,created_at",
          id: inFilter(gameSubmissionIds),
        })
        : [],
    ]);

    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
    const latestByConversation = new Map();
    latestMessages.forEach((message) => {
      if (!latestByConversation.has(message.conversation_id)) {
        latestByConversation.set(message.conversation_id, message);
      }
    });
    const reportsById = new Map(postReports.map((report) => [report.id, report]));
    const profileReportsById = new Map(profileReports.map((report) => [report.id, report]));
    const submissionsById = new Map(gameSubmissions.map((submission) => [submission.id, submission]));

    return jsonResponse({
      tickets: tickets.map((ticket) => {
        const source = ticket.source_type === "post_report"
          ? reportsById.get(ticket.source_id)
          : ticket.source_type === "profile_report"
            ? profileReportsById.get(ticket.source_id)
            : submissionsById.get(ticket.source_id);
        const latestMessage = latestByConversation.get(ticket.conversation_id) || null;
        return {
          id: ticket.id,
          conversationId: ticket.conversation_id,
          sourceType: ticket.source_type,
          sourceId: ticket.source_id,
          title: ticket.title || sourceLabel(ticket, source),
          sourceLabel: sourceLabel(ticket, source),
          status: ticket.status,
          reopenable: ticket.reopenable,
          userCanReply: ticket.user_can_reply,
          createdAt: ticket.created_at,
          updatedAt: ticket.updated_at,
          closedAt: ticket.closed_at,
          requester: toProfile(profilesById.get(ticket.requester_id)),
          source: source || null,
          latestMessage: latestMessage ? {
            id: latestMessage.id,
            body: latestMessage.body || (latestMessage.media_url ? "Imagem enviada" : ""),
            senderId: latestMessage.sender_id,
            createdAt: latestMessage.created_at,
          } : null,
        };
      }),
    });
  } catch (error) {
    console.error("admin tickets failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar casos." }, { status: 500 });
  }
}
