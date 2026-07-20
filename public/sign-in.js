const feedback = document.querySelector("#auth-feedback");
const authButtons = [...document.querySelectorAll("[data-provider]")];

const providerConfig = {
  google: {
    label: "Google",
    loading: "Conectando com Google...",
    options: {
      queryParams: {
        access_type: "offline",
        prompt: "select_account",
      },
    },
  },
  discord: {
    label: "Discord",
    loading: "Conectando com Discord...",
    options: {
      scopes: "identify email",
    },
  },
  twitch: {
    label: "Twitch",
    loading: "Conectando com Twitch...",
    options: {
      scopes: "user:read:email",
    },
  },
};

function getRequestedProvider() {
  const provider = new URLSearchParams(window.location.search).get("provider");
  return providerConfig[provider] ? provider : "";
}

function setLoading(button, label) {
  button.dataset.originalLabel = button.textContent;
  button.textContent = label;
  button.disabled = true;
  button.classList.add("is-loading");
}

function clearLoading(button) {
  button.textContent = button.dataset.originalLabel || button.textContent;
  button.disabled = false;
  button.classList.remove("is-loading");
}

async function signInWithProvider(provider, button) {
  const config = providerConfig[provider];
  if (!config) return;

  setLoading(button, config.loading);
  feedback.textContent = "";

  try {
    const client = await window.GimerrAuth.getClient();
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        ...(config.options || {}),
        redirectTo: window.GimerrAuth.getAuthRedirectUrl(),
      },
    });

    if (error) throw error;
  } catch (error) {
    clearLoading(button);
    feedback.textContent = error.message || `Não foi possível iniciar o login com ${config.label}.`;
  }
}

async function redirectAuthenticatedUser() {
  try {
    const { data } = await window.GimerrAuth.getSession();
    if (data.session) {
      window.location.assign(window.GimerrAuth.getAuthRedirectUrl());
      return true;
    }
  } catch (error) {
    feedback.textContent = error.message;
  }
  return false;
}

authButtons.forEach((button) => {
  button.addEventListener("click", () => {
    signInWithProvider(button.dataset.provider, button);
  });
});

async function initSignIn() {
  const redirected = await redirectAuthenticatedUser();
  if (redirected) return;

  const requestedProvider = getRequestedProvider();
  if (requestedProvider) {
    const button = authButtons.find((item) => item.dataset.provider === requestedProvider);
    const autoStartKey = `gimerr-oauth-autostart-${requestedProvider}`;
    if (button && !sessionStorage.getItem(autoStartKey)) {
      sessionStorage.setItem(autoStartKey, "1");
      await signInWithProvider(requestedProvider, button);
      return;
    }
  }
}

initSignIn();
