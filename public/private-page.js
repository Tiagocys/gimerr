(function initPrivatePageGuard() {
  async function redirectIfAnonymous() {
    if (!window.GimerrAuth?.getSession) {
      window.location.replace("./sign-in.html");
      return;
    }

    try {
      const { data } = await window.GimerrAuth.getSession();
      if (!data?.session?.user) {
        window.location.replace("./sign-in.html");
        return;
      }
      document.body.classList.remove("private-page-pending");
    } catch {
      window.location.replace("./sign-in.html");
    }
  }

  redirectIfAnonymous();
})();
