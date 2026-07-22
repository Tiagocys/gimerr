(function initGimerrAuth(global) {
  let supabaseClient = null;
  let supabaseClientPromise = null;
  let sessionPromise = null;
  let authCodeHandled = false;
  let authCodeExchangePromise = null;
  let authRedirecting = false;
  const AUTH_RETURN_TO_KEY = "gimerr-auth-return-to";

  async function loadAuthConfig() {
    const response = await fetch("/api/auth-config", {
      headers: { accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error("Não foi possível carregar a configuração de autenticação.");
    }

    const config = await response.json();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error("Configuração de autenticação incompleta.");
    }

    return config;
  }

  async function getClient() {
    if (supabaseClient) return supabaseClient;
    if (supabaseClientPromise) return supabaseClientPromise;

    if (!global.supabase?.createClient) {
      throw new Error("Cliente de autenticação indisponível.");
    }

    supabaseClientPromise = loadAuthConfig()
      .then((config) => {
        supabaseClient = global.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: {
            flowType: "pkce",
            detectSessionInUrl: false,
          },
        });
        return supabaseClient;
      })
      .catch((error) => {
        supabaseClientPromise = null;
        throw error;
      });

    return supabaseClientPromise;
  }

  function getAuthRedirectUrl(path = "/") {
    const rawPath = String(path || "/").trim();
    const normalizedPath = rawPath.startsWith("/") && !rawPath.startsWith("//")
      ? rawPath
      : "/";
    return `${global.location.origin}${normalizedPath}`;
  }

  function getStoredReturnPath() {
    const value = global.sessionStorage?.getItem(AUTH_RETURN_TO_KEY) || "";
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "";
    try {
      const url = new URL(value, global.location.origin);
      if (url.origin !== global.location.origin) return "";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "";
    }
  }

  function consumeAuthReturnRedirect() {
    const returnPath = getStoredReturnPath();
    if (!returnPath) return false;
    global.sessionStorage?.removeItem(AUTH_RETURN_TO_KEY);
    if (returnPath === "/") return false;
    const currentPath = `${global.location.pathname}${global.location.search}${global.location.hash}`;
    if (currentPath === returnPath) return false;
    authRedirecting = true;
    global.location.replace(getAuthRedirectUrl(returnPath));
    return true;
  }

  function cleanAuthUrl() {
    const url = new URL(global.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("state");
    url.searchParams.delete("error");
    url.searchParams.delete("error_code");
    url.searchParams.delete("error_description");
    global.history.replaceState({}, document.title, `${url.origin}${url.pathname}${url.search}`);
  }

  async function recoverHashSession(client) {
    if (!global.location.hash.includes("access_token=")) return;

    const hashParams = new URLSearchParams(global.location.hash.slice(1));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");

    if (accessToken && refreshToken) {
      const { error } = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) throw error;
    }

    global.history.replaceState({}, document.title, `${global.location.origin}${global.location.pathname}${global.location.search}`);
  }

  async function exchangeAuthCode(client, code) {
    if (!code) return;

    if (!authCodeExchangePromise && !authCodeHandled) {
      authCodeHandled = true;
      authCodeExchangePromise = client.auth.exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) throw error;
          cleanAuthUrl();
          consumeAuthReturnRedirect();
        })
        .finally(() => {
          authCodeExchangePromise = null;
        });
    }

    if (authCodeExchangePromise) {
      await authCodeExchangePromise;
    }
  }

  async function clearInvalidLocalSession(client) {
    try {
      await client.auth.signOut({ scope: "local" });
    } catch {
      try {
        await client.auth.signOut();
      } catch {
        // Ignore cleanup failures; callers will still receive a null session.
      }
    }
  }

  async function getValidatedSession(client) {
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token || !data.session.user?.id) {
      if (data?.session?.access_token) await clearInvalidLocalSession(client);
      return { data: { session: null }, error: null };
    }

    const validationResponse = await fetch("/api/auth-session", {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${data.session.access_token}`,
      },
    });
    const validation = await validationResponse.json().catch(() => ({}));
    if (!validationResponse.ok || !validation.authenticated || !validation.user?.id) {
      await clearInvalidLocalSession(client);
      return { data: { session: null }, error: null };
    }

    return {
      data: {
        session: {
          ...data.session,
          user: validation.user,
        },
      },
      error: null,
    };
  }

  async function getSession() {
    if (sessionPromise) return sessionPromise;

    sessionPromise = (async () => {
      const client = await getClient();
      const params = new URLSearchParams(global.location.search);
      const code = params.get("code");

      await recoverHashSession(client);
      await exchangeAuthCode(client, code);

      if (authRedirecting) {
        return { data: { session: null }, error: null, redirecting: true };
      }

      return getValidatedSession(client);
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });

    return sessionPromise;
  }

  global.GimerrAuth = {
    getClient,
    getAuthRedirectUrl,
    getSession,
    isAuthRedirecting: () => authRedirecting,
  };
})(window);
