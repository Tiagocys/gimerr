import { getSupabaseRestUrl, jsonResponse } from "../_shared/auth.js";
import { getServiceHeaders, requireAdminUser } from "../_shared/admin.js";

const MAX_SEARCH_TAGS = 5;
const MAX_GENRES = 5;
const MAX_PLATFORMS = 8;

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  return source
    .map((item) => cleanText(typeof item === "string" ? item : item?.name, 40).toLowerCase())
    .filter((item) => {
      if (item.length < 2 || seen.has(item)) return false;
      seen.add(item);
      return true;
    })
    .slice(0, MAX_SEARCH_TAGS);
}

function normalizeTaxonomyItems(value, allowedFields, maxItems) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  return value
    .map((item) => {
      const id = Number(item?.id);
      const name = cleanText(typeof item === "string" ? item : item?.name, 80);
      if (!name) return null;

      const seenKey = id ? `id:${id}` : `name:${name.toLowerCase()}`;
      if (seen.has(seenKey)) return null;
      seen.add(seenKey);

      const normalized = id ? { id, name } : { name };
      allowedFields.forEach((field) => {
        const cleanValue = cleanText(item?.[field], 40);
        if (cleanValue) normalized[field] = cleanValue;
      });
      return normalized;
    })
    .filter(Boolean)
    .slice(0, maxItems);
}

async function fetchSubmission(env, id) {
  const url = new URL(`${getSupabaseRestUrl(env)}/game_submission_requests`);
  url.searchParams.set("select", "id,status");
  url.searchParams.set("id", `eq.${id}`);
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: getServiceHeaders(env),
  });
  const rows = await response.json().catch(() => []);

  if (!response.ok) {
    throw new Error(rows.message || "Não foi possível carregar solicitação.");
  }

  return rows[0] || null;
}

async function updateSubmission(env, id, body) {
  const url = new URL(`${getSupabaseRestUrl(env)}/game_submission_requests`);
  url.searchParams.set("id", `eq.${id}`);

  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: getServiceHeaders(env, {
      prefer: "return=representation",
    }),
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => []);

  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível atualizar solicitação.");
  }

  return payload[0] || null;
}

export async function onRequestPost({ request, env }) {
  try {
    const admin = await requireAdminUser(request, env);
    if (admin.error) return admin.error;

    const payload = await request.json().catch(() => ({}));
    const id = cleanText(payload.id, 80);

    if (!id) {
      return jsonResponse({ error: "Solicitação inválida." }, { status: 400 });
    }

    const submission = await fetchSubmission(env, id);
    if (!submission) {
      return jsonResponse({ error: "Solicitação não encontrada." }, { status: 404 });
    }
    if (submission.status !== "pending") {
      return jsonResponse({ error: "Só é possível editar solicitações pendentes." }, { status: 409 });
    }

    const updated = await updateSubmission(env, id, {
      search_tags: normalizeTags(payload.searchTags),
      genres: normalizeTaxonomyItems(payload.genres, ["slug"], MAX_GENRES),
      platforms: normalizeTaxonomyItems(payload.platforms, ["slug", "abbreviation"], MAX_PLATFORMS),
    });

    return jsonResponse({ request: updated });
  } catch (error) {
    console.error("admin-game-request-update failed", error);
    return jsonResponse({ error: error?.message || "Falha ao atualizar solicitação." }, { status: 500 });
  }
}
