/* Platform adapter. On CrazyGames it talks to the CrazyGames SDK (ads, gameplay events).
   Everywhere else (our own site) every call is a harmless no-op and ads are "not available". */
(function () {
  "use strict";
  const P = {
    name: "web",
    ready: false,
    adsAvailable: false,
    lastAdError: "",
    _sdk: null,
    sdkMuted: false,
    _muteListeners: [],
    onMuteChange(f) { P._muteListeners.push(f); },
    // Saved progress: CrazyGames Data Module on CrazyGames (same API as localStorage), localStorage elsewhere.
    storage: {
      get(k) {
        try { if (P._sdk && P._sdk.data) { const v = P._sdk.data.getItem(k); if (v != null) return v; } } catch (e) {}
        try { return localStorage.getItem(k); } catch (e) { return null; }
      },
      set(k, v) {
        try { if (P._sdk && P._sdk.data) P._sdk.data.setItem(k, String(v)); } catch (e) {}
        try { localStorage.setItem(k, String(v)); } catch (e) {}
      },
    },
    async init() {
      const C = window.CrazyGames && window.CrazyGames.SDK;
      if (!C) return;
      try {
        await C.init();
        if (C.environment === "disabled") return;
        P._sdk = C; P.name = "crazygames"; P.adsAvailable = true; P.ready = true;
        // follow the CrazyGames site's mute setting
        try {
          const read = (s) => { P.sdkMuted = !!(s && s.muteAudio); P._muteListeners.forEach((f) => { try { f(P.sdkMuted); } catch (e) {} }); };
          if (C.game && C.game.settings) read(C.game.settings);
          if (C.game && C.game.addSettingsChangeListener) C.game.addSettingsChangeListener(read);
        } catch (e) {}
      } catch (e) { /* SDK failed: play without ads */ }
    },
    // CrazyGames username, or "" (guest / not available)
    async username() {
      try { if (P._sdk && P._sdk.user && P._sdk.user.getUser) { const u = await P._sdk.user.getUser(); return (u && u.username) || ""; } } catch (e) {}
      return "";
    },
    gameplayStart() { try { P._sdk && P._sdk.game.gameplayStart(); } catch (e) {} },
    gameplayStop() { try { P._sdk && P._sdk.game.gameplayStop(); } catch (e) {} },
    happytime() { try { P._sdk && P._sdk.game.happytime(); } catch (e) {} },
    loadingStart() { try { P._sdk && P._sdk.game.loadingStart(); } catch (e) {} },
    loadingStop() { try { P._sdk && P._sdk.game.loadingStop(); } catch (e) {} },
    // type: "midgame" | "rewarded". Resolves true when the ad finished, false on error / no ad.
    showAd(type, onStart) {
      return new Promise((resolve) => {
        if (!P._sdk || !P.adsAvailable) return resolve(false);
        let done = false;
        const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
        P.lastAdError = "";
        const guard = setTimeout(() => { P.lastAdError = "timeout"; finish(false); }, 60000); // never hang the game
        try {
          P._sdk.ad.requestAd(type, {
            adStarted: () => { try { onStart && onStart(); } catch (e) {} },
            adFinished: () => { clearTimeout(guard); finish(true); },
            adError: (err) => { P.lastAdError = (err && (err.code || err.message)) || String(err || "error"); clearTimeout(guard); finish(false); },
          });
        } catch (e) { clearTimeout(guard); finish(false); }
      });
    },
  };
  window.Platform = P;
})();
