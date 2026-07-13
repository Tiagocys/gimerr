import { getSupabaseRestUrl } from "./auth.js";
import { getServiceHeaders } from "./admin.js";

export function cleanProfileId(value) {
  const text = String(value || "").trim();
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || "";
}

export function inFilter(values) {
  return `in.(${[...new Set(values.filter(Boolean))].join(",")})`;
}

export async function fetchIgnoredProfileIds(env, profileId) {
  const viewerId = cleanProfileId(profileId);
  if (!viewerId) return new Set();

  const url = new URL(`${getSupabaseRestUrl(env)}/user_ignored_profiles`);
  url.searchParams.set("select", "ignored_profile_id");
  url.searchParams.set("profile_id", `eq.${viewerId}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "500");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    const error = new Error(rows.message || "Não foi possível carregar usuários ignorados.");
    error.status = response.status;
    error.details = rows.details || rows.hint || rows.code || "";
    throw error;
  }

  return new Set(rows.map((row) => row.ignored_profile_id).filter(Boolean));
}

export async function fetchIgnoredProfileRows(env, profileId) {
  const ignoredIds = [...(await fetchIgnoredProfileIds(env, profileId))];
  if (!ignoredIds.length) return [];

  const url = new URL(`${getSupabaseRestUrl(env)}/profiles`);
  url.searchParams.set("select", "id,display_name,username,avatar_url");
  url.searchParams.set("id", inFilter(ignoredIds));
  url.searchParams.set("limit", "500");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok) {
    const error = new Error(rows.message || "Não foi possível carregar perfis ignorados.");
    error.status = response.status;
    error.details = rows.details || rows.hint || rows.code || "";
    throw error;
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  return ignoredIds.map((id) => byId.get(id)).filter(Boolean);
}
