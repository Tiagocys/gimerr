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

    const posts = await fetchPosts(env, reports.map((report) => report.post_id));
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
