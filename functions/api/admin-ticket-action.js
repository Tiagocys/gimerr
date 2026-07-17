import { jsonResponse } from "../_shared/auth.js";
import { requireAdminUser } from "../_shared/admin.js";
import { mutateRows, sendSystemMessage } from "../_shared/messages.js";

function cleanText(value, maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function onRequestPost({ request, env }) {
  try {
    const admin = await requireAdminUser(request, env);
    if (admin.error) return admin.error;

    const payload = await request.json().catch(() => ({}));
    const ticketId = cleanText(payload.ticketId, 80);
    const action = cleanText(payload.action, 40);
    if (!ticketId || !new Set(["close", "allow_reply"]).has(action)) {
      return jsonResponse({ error: "Ação inválida." }, { status: 400 });
    }

    if (action === "allow_reply") {
      const [ticket] = await mutateRows(env, "admin_tickets", {
        method: "PATCH",
        params: { id: `eq.${ticketId}`, status: "neq.closed" },
        body: {
          status: "open",
          reopenable: true,
          user_can_reply: true,
        },
      });
      if (!ticket) return jsonResponse({ error: "Caso não encontrado ou já encerrado." }, { status: 404 });
      return jsonResponse({ ok: true, ticket });
    }

    const [ticket] = await mutateRows(env, "admin_tickets", {
      method: "PATCH",
      params: { id: `eq.${ticketId}` },
      body: {
        status: "closed",
        reopenable: false,
        user_can_reply: false,
        closed_at: new Date().toISOString(),
        closed_by: admin.user.id,
      },
    });
    if (!ticket) return jsonResponse({ error: "Caso não encontrado." }, { status: 404 });

    if (ticket.source_type === "post_report") {
      await mutateRows(env, "post_reports", {
        method: "PATCH",
        params: { id: `eq.${ticket.source_id}` },
        body: {
          status: "resolved",
          resolution: "case_closed",
          resolution_note: "Caso encerrado pela equipe do Gimerr.",
          reviewed_at: new Date().toISOString(),
          reviewed_by: admin.user.id,
        },
        prefer: "return=minimal",
      }).catch((error) => console.warn("Não foi possível atualizar post_report do caso.", error));
    }
    if (ticket.source_type === "profile_report") {
      await mutateRows(env, "profile_reports", {
        method: "PATCH",
        params: { id: `eq.${ticket.source_id}` },
        body: {
          status: "resolved",
          resolution: "case_closed",
          resolution_note: "Caso encerrado pela equipe do Gimerr.",
          reviewed_at: new Date().toISOString(),
          reviewed_by: admin.user.id,
        },
        prefer: "return=minimal",
      }).catch((error) => console.warn("Não foi possível atualizar profile_report do caso.", error));
    }

    if (ticket?.requester_id) {
      await sendSystemMessage(
        env,
        ticket.requester_id,
        "Este caso foi encerrado pela equipe do Gimerr. Se precisar de ajuda com outro assunto, abra uma nova solicitação.",
      );
    }

    return jsonResponse({ ok: true, ticket });
  } catch (error) {
    console.error("admin ticket action failed", error);
    return jsonResponse({ error: error?.message || "Falha ao atualizar caso." }, { status: 500 });
  }
}
