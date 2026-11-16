/*
 * NPF-Q400 APP — couche « app » minimale (version 0.1).
 *
 * Ce fichier n'appartient PAS au code NPF-Q400 TEST. Il est ajouté par
 * scripts/build-www.mjs en tout premier dans <head> de www/index.html,
 * avant tous les scripts de la PWA.
 *
 * Hors de l'app (navigateur normal) : il ne fait RIEN, la page se comporte
 * exactement comme la PWA NPF-Q400 TEST.
 *
 * Dans l'app (Capacitor iOS, origine capacitor://localhost) :
 *   1. signale qu'on est dans l'app (window.NPF_Q400_APP, classe html.npf-q400-app) ;
 *   2. rend le service worker invisible pour la PWA (elle ne l'enregistre donc pas) ;
 *   3. empêche l'affichage des fenêtres de mise à jour de la PWA
 *      (« Mise à jour » et « Mise à jour installée »).
 * Rien d'autre (PDF, trace, écran allumé, NAS/VPS : étapes suivantes).
 */
(function npfQ400AppLayer() {
    'use strict';

    var LAYER_VERSION = '0.1';
    var BASE_VERSION = '__NPF_Q400_BASE_VERSION__';

    function detectApp() {
        try {
            var cap = window.Capacitor;
            if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
                return 'capacitor';
            }
        } catch (_) {}
        try {
            if (window.location.protocol === 'capacitor:') return 'protocole';
        } catch (_) {}
        /*
         * Simulation pour les essais sur PC uniquement : ?npfq400app-sim=1,
         * accepté seulement sur localhost / 127.0.0.1 (jamais en ligne).
         */
        try {
            var host = window.location.hostname;
            var local = host === 'localhost' || host === '127.0.0.1';
            if (local && new URL(window.location.href).searchParams.get('npfq400app-sim') === '1') {
                return 'simulation-pc';
            }
        } catch (_) {}
        return '';
    }

    var detectedBy = detectApp();
    if (!detectedBy) return; /* navigateur normal : comportement PWA inchangé */

    var state = {
        isApp: true,
        detectedBy: detectedBy,
        layerVersion: LAYER_VERSION,
        baseVersion: BASE_VERSION,
        serviceWorkerHidden: false,
        updateWindowsBlocked: 0
    };
    window.NPF_Q400_APP = state;
    try { document.documentElement.classList.add('npf-q400-app'); } catch (_) {}

    /* 2. Service worker : la PWA teste `'serviceWorker' in navigator` partout. */
    try {
        if ('serviceWorker' in navigator) {
            delete Navigator.prototype.serviceWorker;
        }
        state.serviceWorkerHidden = !('serviceWorker' in navigator);
    } catch (_) {
        state.serviceWorkerHidden = !('serviceWorker' in navigator);
    }

    /* 3. Fenêtres de mise à jour de la PWA : masquées puis retirées dès leur création. */
    var BLOCKED_IDS = ['update-reminder-modal', 'post-update-restart-modal'];
    try {
        var style = document.createElement('style');
        style.id = 'npf-q400-app-style';
        style.textContent = BLOCKED_IDS.map(function (id) {
            return 'html.npf-q400-app #' + id;
        }).join(',') + '{display:none !important;}';
        (document.head || document.documentElement).appendChild(style);
    } catch (_) {}

    function removeBlocked() {
        for (var i = 0; i < BLOCKED_IDS.length; i++) {
            var el = document.getElementById(BLOCKED_IDS[i]);
            if (el && el.parentNode) {
                el.parentNode.removeChild(el);
                state.updateWindowsBlocked += 1;
            }
        }
    }
    /*
     * Les deux fenêtres sont ajoutées directement dans <body> : on surveille
     * seulement les enfants directs de <body> (pas toute la carte), pour ne
     * rien coûter pendant l'usage normal.
     */
    try {
        var bodyObserved = false;
        var watchBody = function () {
            if (bodyObserved || !document.body) return;
            bodyObserved = true;
            new MutationObserver(removeBlocked).observe(document.body, { childList: true });
            removeBlocked();
        };
        if (document.body) {
            watchBody();
        } else {
            var rootObserver = new MutationObserver(function () {
                if (document.body) {
                    rootObserver.disconnect();
                    watchBody();
                }
            });
            rootObserver.observe(document.documentElement, { childList: true });
            document.addEventListener('DOMContentLoaded', watchBody, { once: true });
        }
    } catch (_) {}
})();
