import { getSupabaseRestUrl, jsonResponse } from "../_shared/auth.js";
import { getServiceHeaders, requireAdminUser } from "../_shared/admin.js";

async function fetchSubmitters(env, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();

  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,display_name,username,avatar_url");
  url.searchParams.set("id", `in.(${ids.join(",")})`);

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) return new Map();

  return new Map(rows.map((profile) => [profile.id, profile]));
}

function toPublicRequest(request, submitters) {
  return {
    id: request.id,
    name: request.name,
    websiteUrl: request.website_url,
    summary: request.summary,
    coverUrl: request.cover_url,
    sourceQuery: request.source_query,
    status: request.status,
    reviewNotes: request.review_notes,
    createdAt: request.created_at,
    searchTags: request.search_tags || [],
    genres: request.genres || [],
    platforms: request.platforms || [],
    submittedBy: submitters.get(request.submitted_by) || null,
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const admin = await requireAdminUser(request, env);
    if (admin.error) return admin.error;

    const pageUrl = new URL(request.url);
    const status = pageUrl.searchParams.get("status") || "pending";
    const allowedStatuses = new Set(["pending", "approved", "rejected", "all"]);
    const cleanStatus = allowedStatuses.has(status) ? status : "pending";

    const url = new URL(`${getSupabaseRestUrl(env)}/game_submission_requests`);
    url.searchParams.set("select", "id,submitted_by,name,website_url,summary,cover_url,source_query,status,review_notes,created_at,search_tags,genres,platforms");
    if (cleanStatus !== "all") {
      url.searchParams.set("status", `eq.${cleanStatus}`);
    }
    url.searchParams.set("order", "created_at.asc");
    url.searchParams.set("limit", "100");

    const response = await fetch(url.toString(), {
      headers: getServiceHeaders(env),
    });
    const rows = await response.json().catch(() => []);

    if (!response.ok) {
      throw new Error(rows.message || "Não foi possível carregar solicitações.");
    }

    const submitters = await fetchSubmitters(env, rows.map((item) => item.submitted_by));
    return jsonResponse({
      requests: rows.map((item) => toPublicRequest(item, submitters)),
    });
  } catch (error) {
    console.error("admin-game-requests failed", error);
    return jsonResponse({ error: error?.message || "Falha ao carregar solicitações." }, { status: 500 });
  }
}
