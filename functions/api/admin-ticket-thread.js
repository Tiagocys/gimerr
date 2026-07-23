import { jsonResponse } from "../_shared/auth.js";
import { requireAdminUser } from "../_shared/admin.js";
import { cleanUuid, fetchRows, inFilter, toProfile } from "../_shared/messages.js";

function postReportLabel(type) {
  if (type === "video") return "Vídeo denunciado";
  if (type === "listing") return "Anúncio denunciado";
  return "Post denunciado";
}

async function loadTicketSource(env, ticket) {
  if (ticket.source_type === "post_report") {
    const [report] = await fetchRows(env, "post_reports", {
      select: "id,reason,status,resolution,created_at,post_id,reported_profile_id,reported_post_type,reported_post_body,reported_media_url,reported_media_type,reported_video_thumbnail_url",
      id: `eq.${ticket.source_id}`,
      limit: "1",
    });
    if (!report) return null;
    const [post] = report.post_id
      ? await fetchRows(env, "feed_posts", {
        select: "id,status",
        id: `eq.${report.post_id}`,
        limit: "1",
      })
      : [];
    const [profile] = report.reported_profile_id
      ? await fetchRows(env, "profiles", {
        select: "id,display_name,username,avatar_url,status",
        id: `eq.${report.reported_profile_id}`,
        limit: "1",
      })
      : [];
    return {
      type: "post_report",
      label: postReportLabel(report.reported_post_type),
      reason: report.reason || "",
      post: {
        id: report.post_id,
        status: post?.status || "deleted",
        type: report.reported_post_type || "",
        body: report.reported_post_body || "",
        mediaUrl: report.reported_media_url || "",
        mediaType: report.reported_media_type || "",
        thumbnailUrl: report.reported_video_thumbnail_url || "",
      },
      profile: toProfile(profile),
    };
  }

  if (ticket.source_type === "profile_report") {
    const [report] = await fetchRows(env, "profile_reports", {
      select: "id,reason,status,resolution,created_at,reported_profile_id,reported_display_name,reported_username,reported_avatar_url",
      id: `eq.${ticket.source_id}`,
      limit: "1",
    });
    if (!report) return null;
    return {
      type: "profile_report",
      label: "Perfil denunciado",
      reason: report.reason || "",
      profile: {
        id: report.reported_profile_id,
        displayName: report.reported_display_name || report.reported_username || "Usuário Gimerr",
        username: report.reported_username || "",
        avatarUrl: report.reported_avatar_url || "",
      },
    };
  }

  if (ticket.source_type === "game_submission") {
    const [submission] = await fetchRows(env, "game_submission_requests", {
      select: "id,name,website,status,review_notes,created_at",
      id: `eq.${ticket.source_id}`,
      limit: "1",
    });
    if (!submission) return null;
    return {
      type: "game_submission",
      label: "Cadastro de jogo",
      game: submission,
    };
  }

  return null;
}

export async function onRequestGet({ request, env }) {
  try {
    const admin = await requireAdminUser(request, env);
    if (admin.error) return admin.error;

    const requestUrl = new URL(request.url);
    const ticketId = cleanUuid(requestUrl.searchParams.get("ticketId"));
    if (!ticketId) return jsonResponse({ error: "Caso inválido." }, { status: 400 });

    const [ticket] = await fetchRows(env, "admin_tickets", {
      select: "id,conversation_id,source_type,source_id,requester_id,title,status,reopenable,user_can_reply,closed_at,created_at,updated_at",
      id: `eq.${ticketId}`,
      limit: "1",
    });
    if (!ticket) return jsonResponse({ error: "Caso não encontrado." }, { status: 404 });

    const [participants, messages, source] = await Promise.all([
      fetchRows(env, "message_conversation_participants", {
        select: "conversation_id,profile_id,last_read_at,created_at",
        conversation_id: `eq.${ticket.conversation_id}`,
      }),
      fetchRows(env, "conversation_messages", {
        select: "id,conversation_id,sender_id,body,media_url,media_type,created_at",
        conversation_id: `eq.${ticket.conversation_id}`,
        status: "eq.active",
        order: "created_at.asc",
        limit: "160",
      }),
      loadTicketSource(env, ticket),
    ]);

    const profileIds = [...participants.map((row) => row.profile_id), ...messages.map((row) => row.sender_id)].filter(Boolean);
    const profileRows = profileIds.length
      ? await fetchRows(env, "profiles", {
        select: "id,display_name,username,avatar_url",
        id: inFilter(profileIds),
      })
      : [];
    const profiles = new Map(profileRows.map((profile) => [profile.id, profile]));

    return jsonResponse({
      ticket: {
        id: ticket.id,
        conversationId: ticket.conversation_id,
        sourceType: ticket.source_type,
        sourceId: ticket.source_id,
        title: ticket.title,
        status: ticket.status,
        reopenable: ticket.reopenable,
        userCanReply: ticket.user_can_reply,
        closedAt: ticket.closed_at,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
      },
      source,
      participants: participants.map((participant) => ({
        ...participant,
        profile: toProfile(profiles.get(participant.profile_id)),
      })),
      messages: messages.map((message) => ({
        id: message.id,
        conversationId: message.conversation_id,
        body: message.body || "",
        mediaUrl: message.media_url || "",
        mediaType: message.media_type || "",
        createdAt: message.created_at,
        author: toProfile(profiles.get(message.sender_id)),
      })),
    });
  } catch (error) {
    console.error("admin ticket thread failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar conversa do caso." }, { status: 500 });
  }
}
