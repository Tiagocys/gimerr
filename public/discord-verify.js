const feedback = document.querySelector("#discord-verify-feedback");
const authButton = document.querySelector("#discord-verify-auth");
const homeButton = document.querySelector("#discord-verify-home");

function getToken() {
  return new URLSearchParams(window.location.search).get("token") || "";
}

function setFeedback(message, tone = "") {
  feedback.textContent = message || "";
  feedback.className = `auth-feedback${tone ? ` is-${tone}` : ""}`;
}

function setLoading(isLoading, label = "Verificando...") {
  authButton.disabled = isLoading;
  authButton.classList.toggle("is-loading", isLoading);
  authButton.querySelector("span").textContent = isLoading ? label : "Continuar com Discord";
}

async function signInWithDiscord() {
  const token = getToken();
  if (!token) {
    setFeedback("Link de verificação inválido. Clique novamente no botão do Discord.", "error");
    return;
  }

  setLoading(true, "Abrindo Discord...");
  try {
    const client = await window.GimerrAuth.getClient();
    const { error } = await client.auth.signInWithOAuth({
      provider: "discord",
      options: {
        scopes: "identify email",
        redirectTo: `${window.location.origin}/discord-verify.html?token=${encodeURIComponent(token)}`,
      },
    });
    if (error) throw error;
  } catch (error) {
    setLoading(false);
    setFeedback(error.message || "Não foi possível abrir o Discord.", "error");
  }
}

async function completeVerification() {
  const token = getToken();
  if (!token) {
    setFeedback("Link de verificação inválido. Clique novamente no botão do Discord.", "error");
    authButton.disabled = true;
    return;
  }

  setLoading(true);
  try {
    const { data } = await window.GimerrAuth.getSession();
    if (!data.session) {
      setLoading(false);
      setFeedback("Entre com Discord para concluir a verificação.");
      return;
    }

    const response = await fetch("/api/discord/verification-complete", {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${data.session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (payload.code === "discord_login_required") {
        setLoading(false);
        setFeedback(payload.error || "Entre usando Discord para concluir.");
        return;
      }
      throw new Error(payload.error || "Não foi possível concluir a verificação.");
    }

    setFeedback("Conta verificada. Você já pode publicar no Gimerr.", "success");
    authButton.hidden = true;
    homeButton.hidden = false;
    window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname}`);
  } catch (error) {
    setLoading(false);
    setFeedback(error.message || "Não foi possível concluir a verificação.", "error");
  }
}

authButton.addEventListener("click", signInWithDiscord);
completeVerification();
