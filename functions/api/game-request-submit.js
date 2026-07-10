import { deleteR2Object, getSupabaseRestUrl, jsonResponse, requireAuthUser } from "../_shared/auth.js";

const MAX_SEARCH_TAGS = 5;
const MAX_GENRES = 5;
const MAX_PLATFORMS = 8;

function getServiceHeaders(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente.");
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    accept: "application/json",
    prefer: "return=representation",
  };
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeWebsite(value) {
  const raw = cleanText(value, 300);
  if (!raw) return "";

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Informe um website com http ou https.");
  }
  return url.toString();
}

function normalizeComparableName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableWebsite(value) {
  const raw = cleanText(value, 300);
  if (!raw) return "";

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, "");
    const port = url.port ? `:${url.port}` : "";
    const pathname = decodeURIComponent(url.pathname || "")
      .replace(/\/+$/, "");
    const search = url.search || "";
    return `${hostname}${port}${pathname}${search}`;
  } catch (_error) {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "")
      .trim();
  }
}

function escapePostgrestLike(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function getWebsiteVariants(value) {
  const normalized = normalizeComparableWebsite(value);
  if (!normalized) return [];

  const variants = new Set();
  const [hostWithPath, query = ""] = normalized.split("?");
  const slashVariants = new Set([hostWithPath, `${hostWithPath}/`]);

  slashVariants.forEach((item) => {
    const path = `${item}${query ? `?${query}` : ""}`;
    variants.add(`https://${path}`);
    variants.add(`http://${path}`);
    variants.add(`https://www.${path}`);
    variants.add(`http://www.${path}`);
  });

  return [...variants];
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(source
    .map((item) => cleanText(item, 40).toLowerCase())
    .filter((item) => item.length >= 2))]
    .slice(0, MAX_SEARCH_TAGS);
}

function normalizeFreeTextItems(value, maxItems) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  return source
    .map((item) => cleanText(item, 80))
    .filter((item) => {
      const key = item.toLowerCase();
      if (item.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((name) => ({ name }))
    .slice(0, maxItems);
}

function normalizeTaxonomyItems(value, allowedFields, maxItems) {
  if (typeof value === "string") {
    return normalizeFreeTextItems(value, maxItems);
  }

  if (!Array.isArray(value)) return [];

  if (value.every((item) => typeof item === "string")) {
    return normalizeFreeTextItems(value, maxItems);
  }

  const seen = new Set();
  return value
    .map((item) => {
      const id = Number(item?.id);
      const name = cleanText(item?.name, 80);
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

async function fetchJson(url, headers) {
  const response = await fetch(url.toString(), { headers });
  const payload = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível validar duplicidade do jogo.");
  }
  return Array.isArray(payload) ? payload : [];
}

async function findPendingSubmissionConflict(env, nameKey, websiteKey) {
  const url = new URL(`${getSupabaseRestUrl(env)}/game_submission_requests`);
  url.searchParams.set("select", "id,name,website_url,status");
  url.searchParams.set("status", "eq.pending");
  url.searchParams.set("limit", "1000");

  const rows = await fetchJson(url, getServiceHeaders(env));
  return rows.find((row) => normalizeComparableName(row.name) === nameKey)
    ? { type: "pending_name" }
    : rows.find((row) => normalizeComparableWebsite(row.website_url) === websiteKey)
      ? { type: "pending_website" }
      : null;
}

async function findExistingGameNameConflict(env, name, nameKey) {
  const headers = getServiceHeaders(env);
  const candidates = [];
  const exactUrl = new URL(`${getSupabaseRestUrl(env)}/igdb_games`);
  exactUrl.searchParams.set("select", "igdb_id,name,websites");
  exactUrl.searchParams.set("name", `ilike.${escapePostgrestLike(name)}`);
  exactUrl.searchParams.set("limit", "20");
  candidates.push(...await fetchJson(exactUrl, headers));

  const searchUrl = new URL(`${getSupabaseRestUrl(env)}/igdb_games`);
  searchUrl.searchParams.set("select", "igdb_id,name,websites");
  searchUrl.searchParams.set("search_text", `ilike.*${escapePostgrestLike(nameKey)}*`);
  searchUrl.searchParams.set("limit", "50");
  candidates.push(...await fetchJson(searchUrl, headers));

  const unique = new Map(candidates.map((game) => [game.igdb_id, game]));
  return [...unique.values()].some((game) => normalizeComparableName(game.name) === nameKey)
    ? { type: "existing_name" }
    : null;
}

async function findExistingGameWebsiteConflict(env, websiteUrl) {
  const headers = getServiceHeaders(env);
  const variants = getWebsiteVariants(websiteUrl);

  for (const variant of variants) {
    const url = new URL(`${getSupabaseRestUrl(env)}/igdb_games`);
    url.searchParams.set("select", "igdb_id,name,websites");
    url.searchParams.set("websites", `cs.${JSON.stringify([{ url: variant }])}`);
    url.searchParams.set("limit", "1");
    const rows = await fetchJson(url, headers);
    if (rows.length) return { type: "existing_website" };
  }

  return null;
}

async function findGameRequestConflict(env, name, websiteUrl) {
  const nameKey = normalizeComparableName(name);
  const websiteKey = normalizeComparableWebsite(websiteUrl);

  const pendingConflict = await findPendingSubmissionConflict(env, nameKey, websiteKey);
  if (pendingConflict) return pendingConflict;

  const existingNameConflict = await findExistingGameNameConflict(env, name, nameKey);
  if (existingNameConflict) return existingNameConflict;

  return findExistingGameWebsiteConflict(env, websiteUrl);
}

function getDuplicateMessage(conflict) {
  if (conflict?.type === "pending_name") {
    return "Já existe uma solicitação pendente para um jogo com este nome.";
  }
  if (conflict?.type === "pending_website") {
    return "Já existe uma solicitação pendente para um jogo com este website.";
  }
  if (conflict?.type === "existing_name") {
    return "Já existe um jogo cadastrado com este nome.";
  }
  if (conflict?.type === "existing_website") {
    return "Já existe um jogo cadastrado com este website.";
  }
  return "Este jogo já existe na base do Gimerr.";
}

async function cleanupUploadedCover(env, coverKey) {
  const key = cleanText(coverKey, 500);
  if (!key || !key.startsWith("game_covers/")) return;

  try {
    await deleteR2Object(env, key);
  } catch (error) {
    console.warn("Não foi possível remover logo após solicitação duplicada.", error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireAuthUser(request, env);
    if (auth.error) return auth.error;

    const payload = await request.json().catch(() => ({}));
    const name = cleanText(payload.name, 140);
    let websiteUrl = "";
    try {
      websiteUrl = normalizeWebsite(payload.websiteUrl || payload.website);
    } catch (error) {
      return jsonResponse({ error: error?.message || "Informe um website válido." }, { status: 400 });
    }
    const summary = cleanText(payload.summary, 1200) || null;
    const coverUrl = cleanText(payload.coverUrl, 500) || null;
    const coverKey = cleanText(payload.coverKey, 500) || null;
    const sourceQuery = cleanText(payload.sourceQuery, 120) || null;
    const searchTags = normalizeTags(payload.searchTags || payload.tags);
    const genres = normalizeTaxonomyItems(payload.genres, ["slug"], MAX_GENRES);
    const platforms = normalizeTaxonomyItems(payload.platforms, ["slug", "abbreviation"], MAX_PLATFORMS);

    if (name.length < 2) {
      return jsonResponse({ error: "Informe o nome do jogo." }, { status: 400 });
    }

    if (!websiteUrl) {
      return jsonResponse({ error: "Informe o website oficial do jogo." }, { status: 400 });
    }

    const conflict = await findGameRequestConflict(env, name, websiteUrl);
    if (conflict) {
      await cleanupUploadedCover(env, coverKey);
      return jsonResponse({ error: getDuplicateMessage(conflict) }, { status: 409 });
    }

    const requestBody = {
      submitted_by: auth.user.id,
      name,
      website_url: websiteUrl,
      summary,
      cover_url: coverUrl,
      cover_key: coverKey,
      source_query: sourceQuery,
      search_tags: searchTags,
      genres,
      platforms,
      status: "pending",
    };

    const response = await fetch(`${getSupabaseRestUrl(env)}/game_submission_requests`, {
      method: "POST",
      headers: getServiceHeaders(env),
      body: JSON.stringify(requestBody),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.message || "Não foi possível cadastrar a solicitação.");
    }

    return jsonResponse({ request: data?.[0] || null });
  } catch (error) {
    console.error("game-request-submit failed", error);
    return jsonResponse({ error: error?.message || "Falha ao cadastrar o jogo." }, { status: 500 });
  }
}
