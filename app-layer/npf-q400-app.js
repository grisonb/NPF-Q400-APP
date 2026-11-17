/*
 * NPF-Q400 APP — couche « app » (version 0.5).
 *
 * Ce fichier n'appartient PAS au code NPF-Q400 TEST. Il est ajouté par
 * scripts/build-www.mjs en tout premier dans <head> de www/index.html,
 * avant tous les scripts de la PWA.
 *
 * Hors de l'app (navigateur normal) : il ne fait RIEN, la page se comporte
 * exactement comme la PWA NPF-Q400 TEST.
 *
 * Dans l'app (Capacitor iOS, origine capacitor://localhost) :
 *   0.1  1. signale qu'on est dans l'app (window.NPF_Q400_APP, classe html.npf-q400-app) ;
 *        2. rend le service worker invisible pour la PWA (elle ne l'enregistre donc pas) ;
 *        3. empêche l'affichage des fenêtres de mise à jour de la PWA ;
 *   0.2  4. masque et désactive le bouton « MAJ » ;
 *        5. écran allumé : les demandes « Wake Lock » de la PWA (mêmes déclencheurs)
 *           passent par le plugin natif KeepAwake (@capacitor-community/keep-awake) ;
 *        6. PDF (VAC, PDF terrains, Doc PDF Réduite, Carte Fréquences OPS) : au lieu
 *           d'un nouvel onglet (window.open), ouverture dans la visionneuse PDF.js
 *           interne de la PWA (ouvrirNpfVisionneusePdf, src/218).
 *   0.4  7. GPS : navigator.geolocation passe par le plugin natif @capacitor/geolocation
 *           (une seule autorisation, celle d'iOS ; pas de seconde question « localhost »),
 *           avec exactement le contenu et le comportement du GPS de Safari.
 * Pas encore : trace en arrière-plan, téléchargements/partage, Chat, réglages NAS/VPS.
 */
(function npfQ400AppLayer() {
    'use strict';

    var LAYER_VERSION = '0.5';
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
        updateWindowsBlocked: 0,
        majButtonClicksBlocked: 0,
        keepAwake: 'non installé',
        keepAwakeRequests: 0,
        pdfOpened: 0,
        pdfLast: '',
        pdfErrors: []
    };
    window.NPF_Q400_APP = state;
    try { document.documentElement.classList.add('npf-q400-app'); } catch (_) {}

    /*
     * 0.2 — barres iPadOS du haut et du bas : l'app se place comme la PWA installée
     * sur l'écran d'accueil (classe npf-app-installee de TEST v17.90 / v17.93 :
     * au moins 32 px en haut et 20 px en bas). Sans cela, dans l'app, seule la zone
     * sûre annoncée par le système serait réservée.
     */
    try { document.documentElement.classList.add('npf-app-installee'); } catch (_) {}

    /*
     * Relevé des erreurs JS (DIAG) : gardées dans NPF_Q400_APP.jsErrors et écrites
     * dans la console, que Capacitor recopie dans le journal natif (fabrication
     * Debug, simulateur). Aucun envoi réseau.
     */
    state.jsErrors = [];
    function noteJsError(text) {
        var line = String(text || '').slice(0, 300);
        state.jsErrors.push(line);
        if (state.jsErrors.length > 30) state.jsErrors.shift();
        try { console.error('[NPF-Q400 APP] erreur JS : ' + line); } catch (_) {}
    }
    try {
        window.addEventListener('error', function (event) {
            if (event && event.target && event.target !== window) return; /* ressource non chargée */
            noteJsError((event.message || 'erreur') + ' @' + String(event.filename || '').split('/').pop() + ':' + (event.lineno || ''));
        }, true);
        window.addEventListener('unhandledrejection', function (event) {
            var r = event && event.reason;
            noteJsError('promesse rejetée : ' + String(r && (r.message || r) || r));
        });
    } catch (_) {}

    /* Rapport de démarrage (DIAG) : une seule ligne dans la console, 20 s après le chargement. */
    function rect(selector) {
        try {
            var el = document.querySelector(selector);
            if (!el) return null;
            var r = el.getBoundingClientRect();
            var cs = getComputedStyle(el);
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
                visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 };
        } catch (_) { return null; }
    }
    window.addEventListener('load', function () {
        setTimeout(function () {
            try {
                var rootStyle = getComputedStyle(document.documentElement);
                var report = {
                    layerVersion: LAYER_VERSION,
                    baseVersion: BASE_VERSION,
                    origin: window.location.origin,
                    viewport: window.innerWidth + 'x' + window.innerHeight,
                    orientation: window.innerWidth > window.innerHeight ? 'paysage' : 'portrait',
                    barreHaut: rootStyle.getPropertyValue('--npf-barre-haut').trim(),
                    appReady: document.body.classList.contains('app-ready'),
                    carte: !!document.querySelector('#map.leaflet-container'),
                    tuilesCarte: document.querySelectorAll('#map .leaflet-tile').length,
                    fenetreMaj: !!(document.getElementById('update-reminder-modal') || document.getElementById('post-update-restart-modal')),
                    serviceWorker: 'serviceWorker' in navigator,
                    boutons: rect('#main-action-buttons'),
                    fondBarreHaut: rect('#npf-fond-barre-haut'),
                    versionAffichee: (document.getElementById('app-version-display') || {}).textContent || '',
                    survolee: ((document.getElementById('nearest-commune-display') || {}).textContent || '').trim().slice(0, 80),
                    gps: gpsStats,
                    gpsControle: state.gpsControle,
                    keepAwake: state.keepAwake,
                    keepAwakeDemandes: state.keepAwakeRequests,
                    erreursJs: state.jsErrors.slice()
                };
                state.startupReport = report;
                console.info('[NPF-Q400 APP] rapport ' + JSON.stringify(report));
            } catch (error) {
                noteJsError('rapport : ' + (error && error.message));
            }
        }, 20000);
    }, { once: true });

    /* ---------------------------------------------------------------- 2. service worker */
    try {
        if ('serviceWorker' in navigator) {
            delete Navigator.prototype.serviceWorker;
        }
        state.serviceWorkerHidden = !('serviceWorker' in navigator);
    } catch (_) {
        state.serviceWorkerHidden = !('serviceWorker' in navigator);
    }

    /* ---------------------------------------- 3 + 4. fenêtres de mise à jour, bouton MAJ */
    var BLOCKED_IDS = ['update-reminder-modal', 'post-update-restart-modal'];
    /* #force-update-button : TEST ; #boot-force-update-button : NPF-Q400 pérenne (future base). */
    var MAJ_SELECTOR = '#force-update-button, .force-update-button, #boot-force-update-button';
    try {
        var style = document.createElement('style');
        style.id = 'npf-q400-app-style';
        style.textContent = BLOCKED_IDS.map(function (id) {
            return 'html.npf-q400-app #' + id;
        }).concat(MAJ_SELECTOR.split(',').map(function (s) {
            return 'html.npf-q400-app ' + s.trim();
        })).join(',') + '{display:none !important;}';
        (document.head || document.documentElement).appendChild(style);
    } catch (_) {}

    /* Bouton MAJ désactivé : un clic éventuel n'atteint jamais la PWA. */
    try {
        document.addEventListener('click', function (event) {
            var target = event.target;
            if (target && typeof target.closest === 'function' && target.closest(MAJ_SELECTOR)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                state.majButtonClicksBlocked += 1;
            }
        }, true);
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
     * seulement les enfants directs de <body> (pas toute la carte).
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

    /* ---------------------------------------------------------------- 5. écran allumé */
    /*
     * La PWA demande déjà l'écran allumé via navigator.wakeLock.request('screen')
     * (au démarrage, au retour au premier plan, au premier geste, pendant un
     * téléchargement de carte) et le relâche quand l'app passe en arrière-plan.
     * On garde exactement ces déclencheurs : navigator.wakeLock est remplacé, dans
     * l'app seulement, par un équivalent qui pilote le plugin natif KeepAwake.
     * Écran allumé tant qu'au moins une demande est active.
     */
    (function installKeepAwake() {
        var cap = window.Capacitor;
        var callNative = null;
        if (cap && typeof cap.nativePromise === 'function') {
            callNative = function (method) { return cap.nativePromise('KeepAwake', method, {}); };
        } else if (detectedBy === 'simulation-pc') {
            callNative = function (method) {
                state.keepAwakeLastSimulated = method;
                return Promise.resolve();
            };
        }
        if (!callNative) {
            state.keepAwake = 'indisponible (pont natif absent)';
            return;
        }

        var active = [];
        var nativeAwake = false;
        var queue = Promise.resolve();

        function syncNative() {
            var want = active.length > 0;
            if (want === nativeAwake) return;
            nativeAwake = want;
            queue = queue.then(function () {
                return callNative(want ? 'keepAwake' : 'allowSleep');
            }).then(function () {
                state.keepAwake = want ? 'écran allumé' : 'veille permise';
            }).catch(function (error) {
                state.keepAwake = 'erreur : ' + String(error && (error.message || error) || 'inconnue').slice(0, 120);
            });
        }

        function createSentinel() {
            var sentinel;
            try { sentinel = new EventTarget(); } catch (_) { sentinel = document.createElement('span'); }
            sentinel.type = 'screen';
            sentinel.released = false;
            sentinel.onrelease = null;
            sentinel.release = function () {
                if (sentinel.released) return Promise.resolve();
                sentinel.released = true;
                var at = active.indexOf(sentinel);
                if (at >= 0) active.splice(at, 1);
                syncNative();
                try {
                    var ev = new Event('release');
                    sentinel.dispatchEvent(ev);
                    if (typeof sentinel.onrelease === 'function') sentinel.onrelease(ev);
                } catch (_) {}
                return Promise.resolve();
            };
            return sentinel;
        }

        var wakeLock = {
            request: function (type) {
                if (type !== undefined && type !== 'screen') {
                    return Promise.reject(new TypeError('Type de Wake Lock non pris en charge'));
                }
                if (document.visibilityState !== 'visible') {
                    var err;
                    try { err = new DOMException('Page non visible', 'NotAllowedError'); } catch (_) { err = new Error('NotAllowedError'); }
                    return Promise.reject(err);
                }
                state.keepAwakeRequests += 1;
                var sentinel = createSentinel();
                active.push(sentinel);
                syncNative();
                return Promise.resolve(sentinel);
            }
        };

        /* Comme le vrai Wake Lock : tout est relâché quand l'app passe en arrière-plan. */
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') return;
            active.slice().forEach(function (s) { s.release(); });
        });

        try {
            Object.defineProperty(navigator, 'wakeLock', {
                configurable: true,
                enumerable: true,
                get: function () { return wakeLock; }
            });
            state.keepAwake = navigator.wakeLock === wakeLock ? 'prêt' : 'remplacement refusé';
        } catch (error) {
            state.keepAwake = 'remplacement impossible';
        }
        state.keepAwakeActiveCount = function () { return active.length; };
    })();

    /* ---------------------------------------------------------------- 7. GPS (0.4) */
    /*
     * Dans l'app, le GPS du moteur web (WKWebView) pose une seconde question
     * « localhost aimerait utiliser votre position » à chaque lancement, en plus de
     * l'autorisation d'iOS ; Apple ne permet pas de l'accorder d'office. Dans l'app
     * seulement, navigator.geolocation est donc remplacé par un équivalent qui lit la
     * position par le plugin natif @capacitor/geolocation (une seule autorisation,
     * celle d'iOS). Fonctions : getCurrentPosition, watchPosition, clearWatch.
     *
     * Même contenu que le GPS de Safari (WebKit, GeolocationPositionDataCocoa.mm) :
     *   latitude, longitude, accuracy (précision horizontale), timestamp (ms) ;
     *   altitude + altitudeAccuracy seulement si la précision verticale est valide ;
     *   speed seulement si la vitesse est valide (>= 0) ;
     *   heading = ROUTE SUIVIE (course) seulement si elle est valide — et non la
     *   boussole de l'iPad, que le plugin mettrait en premier.
     * Même comportement que Safari :
     *   haute précision (kCLLocationAccuracyBest, sans filtre de distance → même
     *   cadence d'iOS, ≈ 1 par seconde) : demandée pour chaque appel, pour qu'une
     *   demande ponctuelle ne dégrade jamais le suivi en cours (le plugin n'a qu'un
     *   réglage pour tout) ;
     *   maximumAge : la dernière position est rendue tout de suite si elle est assez
     *   récente (le plugin l'ignore) ;
     *   timeout absent = pas de limite (le plugin mettrait 5 s) ;
     *   suivi : après une erreur « délai dépassé », le suivi continue (le plugin
     *   l'arrêterait) — il est relancé.
     */
    var GPS_NO_TIMEOUT_MS = 24 * 3600 * 1000;
    var gpsStats = {
        etat: 'non installé',
        positions: 0,
        erreurs: 0,
        derniereErreur: '',
        appelsPonctuels: 0,
        reponsesDepuisCache: 0,
        suivisLances: 0,
        suivisRelances: 0,
        optionsDemandees: [],    /* options demandées à navigator.geolocation (PWA et contrôle DIAG ; dernières, sans doublon) */
        optionsNatives: null,    /* options réellement envoyées au plugin (dernières) */
        dernierePosition: null,
        intervallesSuiviMs: []   /* 20 derniers écarts entre deux positions de suivi */
    };
    state.gpsStats = gpsStats;
    (function installGeolocation() {
        var cap = window.Capacitor;
        var native = null;
        if (cap && typeof cap.nativePromise === 'function' && typeof cap.nativeCallback === 'function') {
            native = {
                once: function (o) { return cap.nativePromise('Geolocation', 'getCurrentPosition', o); },
                watch: function (o, cb) { return cap.nativeCallback('Geolocation', 'watchPosition', o, cb); },
                clear: function (id) { return cap.nativePromise('Geolocation', 'clearWatch', { id: id }); }
            };
        } else if (detectedBy === 'simulation-pc') {
            native = makePcSimulatedPlugin();
        }
        if (!native) {
            gpsStats.etat = 'indisponible (pont natif absent)';
            return;
        }

        function finite(v) {
            return v !== null && v !== undefined && v !== '' && isFinite(Number(v));
        }
        /* Position du plugin → position au format de Safari (voir plus haut). */
        function toPosition(data) {
            var c = (data && data.coords) || {};
            var verticalOk = finite(c.altitudeAccuracy) && Number(c.altitudeAccuracy) >= 0;
            var coords = {
                latitude: Number(c.latitude),
                longitude: Number(c.longitude),
                accuracy: finite(c.accuracy) ? Number(c.accuracy) : null,
                altitude: verticalOk && finite(c.altitude) ? Number(c.altitude) : null,
                altitudeAccuracy: verticalOk ? Number(c.altitudeAccuracy) : null,
                heading: finite(c.course) && Number(c.course) >= 0 ? Number(c.course) : null,
                speed: finite(c.speed) && Number(c.speed) >= 0 ? Number(c.speed) : null
            };
            var position = {
                timestamp: finite(data && data.timestamp) ? Math.round(Number(data.timestamp)) : Date.now(),
                coords: coords
            };
            position.toJSON = function () { return { timestamp: position.timestamp, coords: coords }; };
            return position;
        }
        function toError(err) {
            var code = String((err && err.code) || '');
            var message = String((err && err.message) || err || 'position indisponible');
            var c = 2; /* POSITION_UNAVAILABLE */
            if (/(0003|0007|0008)$/.test(code) || /denied|restricted|not enabled/i.test(message)) c = 1;
            else if (/0010$/.test(code) || /time/i.test(message)) c = 3;
            gpsStats.erreurs += 1;
            gpsStats.derniereErreur = message.slice(0, 120);
            return { code: c, message: message, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
        }
        function notePwaOptions(o) {
            var text = JSON.stringify({
                enableHighAccuracy: !!(o && o.enableHighAccuracy),
                timeout: o && finite(o.timeout) ? Number(o.timeout) : 'aucun',
                maximumAge: o && finite(o.maximumAge) ? Number(o.maximumAge) : 0
            });
            if (gpsStats.optionsDemandees.indexOf(text) < 0) {
                gpsStats.optionsDemandees.push(text);
                if (gpsStats.optionsDemandees.length > 8) gpsStats.optionsDemandees.shift();
            }
        }
        function toNativeOptions(o) {
            o = o || {};
            var r = {
                enableHighAccuracy: true,
                timeout: finite(o.timeout) && Number(o.timeout) > 0 ? Math.round(Number(o.timeout)) : GPS_NO_TIMEOUT_MS
            };
            gpsStats.optionsNatives = r;
            return r;
        }
        /* Une erreur dans le code de la PWA doit rester visible (console, DIAG). */
        function callSafely(fn, arg) {
            if (typeof fn !== 'function') return;
            try { fn(arg); } catch (error) { setTimeout(function () { throw error; }, 0); }
        }
        var lastPosition = null;
        function gotPosition(data) {
            var p = toPosition(data);
            lastPosition = p;
            gpsStats.positions += 1;
            gpsStats.etat = 'position reçue';
            gpsStats.dernierePosition = p.toJSON();
            return p;
        }

        var watches = {};
        var nextId = 1;
        function startNativeWatch(id, options, success, error) {
            var lastAt = 0;
            gpsStats.suivisLances += 1;
            watches[id] = native.watch(toNativeOptions(options), function (data, err) {
                if (!watches.hasOwnProperty(id)) return;
                if (err || !data) {
                    var e = toError(err);
                    callSafely(error, e);
                    if (e.code === 3 && watches.hasOwnProperty(id)) {
                        /* Safari continue le suivi après un délai dépassé : on le relance. */
                        var old = watches[id];
                        try { Promise.resolve(native.clear(old)).catch(function () {}); } catch (_) {}
                        gpsStats.suivisRelances += 1;
                        setTimeout(function () {
                            if (watches.hasOwnProperty(id) && watches[id] === old) startNativeWatch(id, options, success, error);
                        }, 1000);
                    }
                    return;
                }
                var p = gotPosition(data);
                var now = Date.now();
                if (lastAt) {
                    gpsStats.intervallesSuiviMs.push(now - lastAt);
                    if (gpsStats.intervallesSuiviMs.length > 20) gpsStats.intervallesSuiviMs.shift();
                }
                lastAt = now;
                callSafely(success, p);
            });
        }

        var geolocation = {
            getCurrentPosition: function (success, error, options) {
                notePwaOptions(options);
                gpsStats.appelsPonctuels += 1;
                var maxAge = options && finite(options.maximumAge) ? Number(options.maximumAge) : 0;
                if (lastPosition && maxAge > 0 && Date.now() - lastPosition.timestamp <= maxAge) {
                    gpsStats.reponsesDepuisCache += 1;
                    var cached = lastPosition;
                    setTimeout(function () { callSafely(success, cached); }, 0);
                    return;
                }
                native.once(toNativeOptions(options)).then(function (data) {
                    callSafely(success, gotPosition(data));
                }, function (err) {
                    callSafely(error, toError(err));
                });
            },
            watchPosition: function (success, error, options) {
                notePwaOptions(options);
                var id = nextId++;
                startNativeWatch(id, options, success, error);
                return id;
            },
            clearWatch: function (id) {
                if (!watches.hasOwnProperty(id)) return;
                var nativeId = watches[id];
                delete watches[id];
                try { Promise.resolve(native.clear(nativeId)).catch(function () {}); } catch (_) {}
            }
        };
        try {
            Object.defineProperty(navigator, 'geolocation', {
                configurable: true,
                enumerable: true,
                get: function () { return geolocation; }
            });
            gpsStats.etat = navigator.geolocation === geolocation ? 'prêt' : 'remplacement refusé';
        } catch (_) {
            gpsStats.etat = 'remplacement impossible';
        }
    })();

    /*
     * Essais PC (?npfq400app-sim=1 sur localhost) : imitation du plugin, avec ses
     * données BRUTES (cap boussole différent de la route, valeurs invalides à -1),
     * pour vérifier la conversion au format de Safari. Trajet Marignane → nord-ouest,
     * 60 m/s, route 335°, une position par seconde ; une position sur 5 sans vitesse,
     * sans route et sans altitude valides.
     */
    function makePcSimulatedPlugin() {
        var n = 0;
        var t0 = Date.now();
        function raw() {
            n += 1;
            var s = (Date.now() - t0) / 1000;
            var d = 60 * s;                       /* mètres parcourus */
            var rad = 335 * Math.PI / 180;
            var lat = 43.4367 + (d * Math.cos(rad)) / 111320;
            var lon = 5.2150 + (d * Math.sin(rad)) / (111320 * Math.cos(43.4367 * Math.PI / 180));
            var invalid = n % 5 === 0;
            return { timestamp: Date.now(), coords: {
                latitude: lat, longitude: lon, accuracy: 5,
                altitude: 300, altitudeAccuracy: invalid ? -1 : 10,
                speed: invalid ? -1 : 60,
                course: invalid ? null : 335,
                heading: 90, trueHeading: 90, magneticHeading: 88, headingAccuracy: 5
            } };
        }
        var timers = {};
        var next = 1;
        var sim = {
            calls: [],
            once: function (o) { sim.calls.push(['once', o]); return Promise.resolve(raw()); },
            watch: function (o, cb) {
                sim.calls.push(['watch', o]);
                var id = 'sim-' + (next++);
                setTimeout(function () { cb(raw()); }, 0);
                timers[id] = setInterval(function () { cb(raw()); }, 1000);
                return id;
            },
            clear: function (id) { clearInterval(timers[id]); delete timers[id]; return Promise.resolve(); }
        };
        state.gpsSimulationPc = sim;
        return sim;
    }

    /*
     * Contrôle GPS (DIAG) — seulement en fabrication Debug (simulateur) et en essai PC,
     * jamais dans l'app livrée : 3 s après le chargement, un suivi de 14 s exactement
     * comme celui de la PWA (mêmes options), pour mesurer la cadence et les champs reçus.
     */
    var gpsCheckWanted = detectedBy === 'simulation-pc' || !!(window.Capacitor && window.Capacitor.DEBUG === true);
    state.gpsControle = gpsCheckWanted ? 'prévu' : 'non lancé (app livrée)';
    if (gpsCheckWanted) {
        window.addEventListener('load', function () {
            setTimeout(function () {
                if (!navigator.geolocation || typeof navigator.geolocation.watchPosition !== 'function') return;
                var samples = [];
                var errors = [];
                state.gpsControle = 'en cours';
                var id = navigator.geolocation.watchPosition(function (p) {
                    samples.push({ at: Date.now(), p: p });
                }, function (e) {
                    errors.push(e && e.message);
                }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 600000 });
                setTimeout(function () {
                    navigator.geolocation.clearWatch(id);
                    var gaps = [];
                    for (var i = 1; i < samples.length; i++) gaps.push(samples[i].at - samples[i - 1].at);
                    var sorted = gaps.slice().sort(function (a, b) { return a - b; });
                    var has = function (k) { return samples.filter(function (s) { return s.p.coords[k] !== null; }).length; };
                    var last = samples.length ? samples[samples.length - 1].p : null;
                    state.gpsControle = {
                        dureeS: 14,
                        positions: samples.length,
                        ecartMedianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
                        ecartMinMs: sorted.length ? sorted[0] : null,
                        ecartMaxMs: sorted.length ? sorted[sorted.length - 1] : null,
                        avecVitesse: has('speed'),
                        avecCap: has('heading'),
                        avecAltitude: has('altitude'),
                        avecPrecision: has('accuracy'),
                        heureEnMs: last ? last.timestamp > 1e12 : null,
                        retardHeureMs: last ? (samples[samples.length - 1].at - last.timestamp) : null,
                        derniere: last ? last.toJSON() : null,
                        erreurs: errors.slice(0, 5)
                    };
                }, 14000);
            }, 3000);
        }, { once: true });
    }

    /* ---------------------------------------------------------------- 6. PDF */
    /*
     * La PWA ouvre ses PDF ainsi : w = window.open('', '_blank') puis
     * w.location.href = adresse du PDF (fichier hors ligne en blob:, ou ./pdf/… ),
     * ou w.close() si rien n'est trouvé. Dans l'app, window.open ne crée pas
     * d'onglet. On rend donc une « fenêtre » factice : l'adresse reçue est lue
     * puis affichée dans la visionneuse PDF.js interne (ouvrirNpfVisionneusePdf).
     */
    var pendingTitle = '';
    var pendingTitleAt = 0;

    function takeTitle() {
        var t = (Date.now() - pendingTitleAt < 120000) ? pendingTitle : '';
        pendingTitle = '';
        return t || 'PDF';
    }

    function reportPdfError(message) {
        state.pdfErrors.push(message);
        if (state.pdfErrors.length > 10) state.pdfErrors.shift();
        try { window.alert('NPF-Q400 APP — ' + message); } catch (_) {}
    }

    function openInViewer(url, title) {
        state.pdfLast = title + ' (' + String(url).slice(0, 60) + ')';
        if (typeof window.ouvrirNpfVisionneusePdf !== 'function') {
            reportPdfError('visionneuse PDF interne absente : ' + title + ' non ouvert.');
            return;
        }
        fetch(url).then(function (response) {
            if (!response.ok) throw new Error('réponse ' + response.status);
            return response.blob();
        }).then(function (blob) {
            return blob.slice(0, 5).text().then(function (head) {
                if (head.indexOf('%PDF') !== 0) throw new Error('le fichier reçu n\'est pas un PDF');
                return blob.type === 'application/pdf' ? blob : blob.slice(0, blob.size, 'application/pdf');
            });
        }).then(function (pdfBlob) {
            state.pdfOpened += 1;
            return window.ouvrirNpfVisionneusePdf(title, pdfBlob);
        }).catch(function (error) {
            reportPdfError('ouverture de « ' + title + ' » impossible (' + String(error && (error.message || error) || 'erreur').slice(0, 120) + ').');
        });
    }

    function createPdfWindow() {
        var fake = { closed: false, opener: window };
        var title = takeTitle();
        var location = {};
        Object.defineProperty(location, 'href', {
            get: function () { return 'about:blank'; },
            set: function (url) {
                if (fake.closed) return;
                fake.closed = true;
                openInViewer(String(url), title);
            }
        });
        location.assign = function (url) { location.href = url; };
        location.replace = function (url) { location.href = url; };
        fake.location = location;
        fake.close = function () { fake.closed = true; };
        fake.focus = function () {};
        return fake;
    }

    function looksLikePdf(url) {
        return /^blob:/i.test(url) || /\.pdf(?:[?#]|$)/i.test(url);
    }

    try {
        var originalOpen = window.open;
        window.open = function (url) {
            var u = url == null ? '' : String(url);
            if (u === '' || u === 'about:blank' || looksLikePdf(u)) {
                var w = createPdfWindow();
                if (u && u !== 'about:blank') w.location.href = u;
                return w;
            }
            return originalOpen.apply(window, arguments);
        };
    } catch (_) {}

    /* Titres affichés dans la visionneuse : posés au moment du clic sur le bouton. */
    function wrapTitle(name, makeTitle) {
        var original = window[name];
        if (typeof original !== 'function' || original.__npfQ400AppWrapped) return;
        var wrapped = function () {
            pendingTitle = makeTitle.apply(null, arguments);
            pendingTitleAt = Date.now();
            return original.apply(this, arguments);
        };
        wrapped.__npfQ400AppWrapped = true;
        window[name] = wrapped;
    }
    function code(value) {
        return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    document.addEventListener('DOMContentLoaded', function () {
        wrapTitle('openVacPdf', function (oaci) { return 'VAC ' + code(oaci); });
        wrapTitle('openAirportPdf', function (oaci) { return 'PDF ' + code(oaci); });
        wrapTitle('openFdfReducedPdf', function () { return 'Doc PDF Réduite'; });
        wrapTitle('openOpsFrequenciesPdf', function () { return 'Carte Fréquences OPS'; });
    }, { once: true });
})();
