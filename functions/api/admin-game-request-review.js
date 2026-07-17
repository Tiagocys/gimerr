import { getSupabaseRestUrl, jsonResponse } from "../_shared/auth.js";
import { getServiceHeaders, requireAdminUser } from "../_shared/admin.js";
import { createAdminTicket } from "../_shared/admin-tickets.js";
import { sendSystemMessage } from "../_shared/messages.js";

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function slugify(value) {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `jogo-${Date.now()}`;
}

function normalizeNameList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item) => cleanText(typeof item === "string" ? item : item?.name, 80))
    .filter((name) => {
      const key = name.toLowerCase();
      if (name.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((name) => ({ name }))
    .slice(0, 20);
}

function normalizeTaxonomy(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((item) => {
      const name = cleanText(typeof item === "string" ? item : item?.name, 80);
      if (!name) return null;
      const key = name.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);

      const result = { name };
      const id = Number(item?.id);
      if (id) result.id = id;
      ["slug", "abbreviation"].forEach((field) => {
        const value = cleanText(item?.[field], 40);
        if (value) result[field] = value;
      });
      return result;
    })
    .filter(Boolean)
    .slice(0, 20);
}

function getReviewMessage(action, submission, reviewNotes) {
  const approved = action === "approve";
  const gameName = submission.name || "Nome do Jogo";
  const lines = [
    `O cadastro do jogo "${gameName}" foi ${approved ? "aprovado" : "reprovado"}.`,
    approved
      ? "Você já pode criar anúncios."
      : "Você pode tentar enviar uma nova solicitação com dados atualizados do cadastro do jogo.",
  ];
  if (reviewNotes) lines.push(`Observação da equipe: ${reviewNotes}`);
  return lines.join("\n\n");
}

function buildManualGame(request) {
  const tags = normalizeNameList([
    request.source_query,
    ...(request.search_tags || []),
  ]);
  const manualId = -(Date.now() * 1000 + Math.floor(Math.random() * 1000));

  return {
    igdb_id: manualId,
    name: request.name,
    slug: slugify(request.name),
    summary: request.summary || null,
    cover_url: request.cover_url || null,
    websites: request.website_url ? [{ url: request.website_url }] : [],
    alternative_names: tags,
    genres: normalizeTaxonomy(request.genres),
    platforms: normalizeTaxonomy(request.platforms),
    popularity_score: 0,
    imported_from: "user_submission",
  };
}

async function fetchSubmission(env, id) {
  const url = new URL(`${getSupabaseRestUrl(env)}/game_submission_requests`);
  url.searchParams.set("select", "id,submitted_by,name,website_url,summary,cover_url,source_query,status,search_tags,genres,platforms");
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

async function insertApprovedGame(env, submission) {
  const game = buildManualGame(submission);
  const response = await fetch(`${getSupabaseRestUrl(env)}/igdb_games?on_conflict=igdb_id`, {
    method: "POST",
    headers: getServiceHeaders(env, {
      prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify(game),
  });
  const payload = await response.json().catch(() => []);

  if (!response.ok) {
    throw new Error(payload.message || "Não foi possível aprovar jogo.");
  }

  return payload[0] || game;
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
    const action = payload.action === "reject" ? "reject" : "approve";
    const reviewNotes = cleanText(payload.reviewNotes, 800) || null;

    if (!id) {
      return jsonResponse({ error: "Solicitação inválida." }, { status: 400 });
    }
    if (action === "reject" && !reviewNotes) {
      return jsonResponse({ error: "Informe o motivo da reprovação." }, { status: 400 });
    }

    const submission = await fetchSubmission(env, id);
    if (!submission) {
      return jsonResponse({ error: "Solicitação não encontrada." }, { status: 404 });
    }

    if (submission.status !== "pending") {
      return jsonResponse({ error: "Esta solicitação já foi analisada." }, { status: 409 });
    }

    let approvedGame = null;
    if (action === "approve") {
      approvedGame = await insertApprovedGame(env, submission);
    }

    const updated = await updateSubmission(env, id, {
      status: action === "approve" ? "approved" : "rejected",
      reviewed_by: admin.user.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes,
      approved_igdb_id: approvedGame?.igdb_id || null,
    });

    const reviewMessage = getReviewMessage(action, submission, reviewNotes);
    if (action === "reject") {
      await createAdminTicket(env, {
        sourceType: "game_submission",
        sourceId: submission.id,
        requesterId: submission.submitted_by,
        title: `Cadastro de jogo reprovado: ${submission.name}`,
        initialMessage: [
          reviewMessage,
          "Você pode responder esta conversa para complementar a solicitação enquanto o caso estiver aberto.",
        ].join("\n\n"),
      });
    } else {
      await sendSystemMessage(env, submission.submitted_by, reviewMessage);
    }

    return jsonResponse({
      request: updated,
      game: approvedGame,
    });
  } catch (error) {
    console.error("admin-game-request-review failed", error);
    return jsonResponse({ error: error?.message || "Falha ao analisar solicitação." }, { status: 500 });
  }
}
