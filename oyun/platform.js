/* Platform adapter. On CrazyGames it talks to the CrazyGames SDK (ads, gameplay events).
   Everywhere else (our own site) every call is a harmless no-op and ads are "not available". */
(function () {
  "use strict";
  const P = {
    name: "web",
    ready: false,
    adsAvailable: false,
    _sdk: null,
    async init() {
      const C = window.CrazyGames && window.CrazyGames.SDK;
      if (!C) return;
      try {
        await C.init();
        if (C.environment === "disabled") return;
        P._sdk = C; P.name = "crazygames"; P.adsAvailable = true; P.ready = true;
      } catch (e) { /* SDK failed: play without ads */ }
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
        const guard = setTimeout(() => finish(false), 60000); // never hang the game
        try {
          P._sdk.ad.requestAd(type, {
            adStarted: () => { try { onStart && onStart(); } catch (e) {} },
            adFinished: () => { clearTimeout(guard); finish(true); },
            adError: () => { clearTimeout(guard); finish(false); },
          });
        } catch (e) { clearTimeout(guard); finish(false); }
      });
    },
  };
  window.Platform = P;
})();
