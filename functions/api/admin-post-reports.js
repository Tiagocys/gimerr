import { getSupabaseRestUrl, jsonResponse } from "../_shared/auth.js";
import { getServiceHeaders, requireAdminUser } from "../_shared/admin.js";

async function fetchProfiles(env, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,display_name,username,avatar_url,status,suspended_until,is_admin");
  url.searchParams.set("id", `in.(${uniqueIds.join(",")})`);
  const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar usuários das denúncias.");
  return new Map(rows.map((profile) => [profile.id, profile]));
}

async function fetchPosts(env, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const url = new URL(`${getSupabaseRestUrl(env)}/feed_posts`);
  url.searchParams.set("select", "id,profile_id,post_type,body,media_url,media_type,video_thumbnail_url,status,created_at");
  url.searchParams.set("id", `in.(${uniqueIds.join(",")})`);
  const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows.message || "Não foi possível carregar posts denunciados.");
  return new Map(rows.map((post) => [post.id, post]));
}

async function fetchReportAttachments(env, reportIds) {
  const uniqueIds = [...new Set(reportIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const ticketsUrl = new URL(`${getSupabaseRestUrl(env)}/admin_tickets`);
  ticketsUrl.searchParams.set("select", "source_id,conversation_id");
  ticketsUrl.searchParams.set("source_type", "eq.post_report");
  ticketsUrl.searchParams.set("source_id", `in.(${uniqueIds.join(",")})`);
  const ticketsResponse = await fetch(ticketsUrl.toString(), { headers: getServiceHeaders(env) });
  const tickets = await ticketsResponse.json().catch(() => []);
  if (!ticketsResponse.ok) throw new Error(tickets.message || "Não foi possível carregar anexos das denúncias.");

  const conversationIds = tickets.map((ticket) => ticket.conversation_id).filter(Boolean);
  if (!conversationIds.length) return new Map();

  const messagesUrl = new URL(`${getSupabaseRestUrl(env)}/conversation_messages`);
  messagesUrl.searchParams.set("select", "id,conversation_id,media_url,media_type,created_at");
  messagesUrl.searchParams.set("conversation_id", `in.(${[...new Set(conversationIds)].join(",")})`);
  messagesUrl.searchParams.set("media_url", "not.is.null");
  messagesUrl.searchParams.set("status", "eq.active");
  messagesUrl.searchParams.set("order", "created_at.asc");
  const messagesResponse = await fetch(messagesUrl.toString(), { headers: getServiceHeaders(env) });
  const messages = await messagesResponse.json().catch(() => []);
  if (!messagesResponse.ok) throw new Error(messages.message || "Não foi possível carregar imagens anexadas.");

  const reportByConversation = new Map(tickets.map((ticket) => [ticket.conversation_id, ticket.source_id]));
  const attachmentsByReport = new Map();
  messages.forEach((message) => {
    const reportId = reportByConversation.get(message.conversation_id);
    if (!reportId) return;
    if (!attachmentsByReport.has(reportId)) attachmentsByReport.set(reportId, []);
    attachmentsByReport.get(reportId).push({
      id: message.id,
      mediaUrl: message.media_url,
      mediaType: message.media_type,
      createdAt: message.created_at,
    });
  });
  return attachmentsByReport;
}

function toPublicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    displayName: profile.display_name || profile.username || "Usuário Gimerr",
    username: profile.username || "",
    avatarUrl: profile.avatar_url || "",
    status: profile.status,
    suspendedUntil: profile.suspended_until,
    isAdmin: Number(profile.is_admin || 0) === 1,
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const admin = await requireAdminUser(request, env);
    if (admin.error) return admin.error;

    const pageUrl = new URL(request.url);
    const requestedStatus = pageUrl.searchParams.get("status") || "pending";
    const status = new Set(["pending", "resolved", "all"]).has(requestedStatus) ? requestedStatus : "pending";
    const url = new URL(`${getSupabaseRestUrl(env)}/post_reports`);
    url.searchParams.set("select", "id,post_id,reporter_id,reason,status,resolution,resolution_note,reviewed_at,reviewed_by,reported_profile_id,reported_post_type,reported_post_body,reported_media_url,reported_media_type,reported_video_thumbnail_url,created_at");
    if (status !== "all") url.searchParams.set("status", `eq.${status}`);
    url.searchParams.set("order", status === "pending" ? "created_at.asc" : "reviewed_at.desc.nullslast");
    url.searchParams.set("limit", "100");

    const response = await fetch(url.toString(), { headers: getServiceHeaders(env) });
    const reports = await response.json().catch(() => []);
    if (!response.ok) throw new Error(reports.message || "Não foi possível carregar denúncias.");

    const [posts, attachmentsByReport] = await Promise.all([
      fetchPosts(env, reports.map((report) => report.post_id)),
      fetchReportAttachments(env, reports.map((report) => report.id)),
    ]);
    const profiles = await fetchProfiles(env, reports.flatMap((report) => {
      const post = posts.get(report.post_id);
      return [report.reporter_id, report.reported_profile_id, post?.profile_id, report.reviewed_by];
    }));

    return jsonResponse({
      reports: reports.map((report) => {
        const currentPost = posts.get(report.post_id) || null;
        const reportedProfileId = currentPost?.profile_id || report.reported_profile_id;
        return {
          id: report.id,
          reason: report.reason || "Motivo não informado.",
          status: report.status,
          resolution: report.resolution,
          resolutionNote: report.resolution_note,
          createdAt: report.created_at,
          reviewedAt: report.reviewed_at,
          reporter: toPublicProfile(profiles.get(report.reporter_id)),
          reportedUser: toPublicProfile(profiles.get(reportedProfileId)),
          reviewedBy: toPublicProfile(profiles.get(report.reviewed_by)),
          attachments: attachmentsByReport.get(report.id) || [],
          post: {
            id: currentPost?.id || report.post_id,
            exists: Boolean(currentPost),
            status: currentPost?.status || "deleted",
            type: currentPost?.post_type || report.reported_post_type,
            body: currentPost?.body || report.reported_post_body || "",
            mediaUrl: currentPost?.media_url || report.reported_media_url || "",
            mediaType: currentPost?.media_type || report.reported_media_type || "",
            thumbnailUrl: currentPost?.video_thumbnail_url || report.reported_video_thumbnail_url || "",
            createdAt: currentPost?.created_at || null,
          },
        };
      }),
    });
  } catch (error) {
    console.error("admin post reports failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar denúncias." }, { status: 500 });
  }
}
