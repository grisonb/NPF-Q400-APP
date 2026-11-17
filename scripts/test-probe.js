/* Sonde d'essai NPF-Q400 APP — injectée UNIQUEMENT par le serveur d'essai de
 * scripts/test-web.mjs, jamais présente dans web-test/ ni dans www/.
 * Relève les erreurs JS, puis, __WAIT_MS__ ms après le chargement, fait les
 * contrôles et renvoie un bilan au serveur d'essai (127.0.0.1). */
(function () {
    var K = 'npfq400ProbeErrors';
    var errs = [];
    try { errs = JSON.parse(sessionStorage.getItem(K) || '[]'); } catch (_) {}
    var save = function () { try { sessionStorage.setItem(K, JSON.stringify(errs.slice(-50))); } catch (_) {} };
    window.addEventListener('error', function (e) {
        if (e && e.target && e.target !== window) return; /* ressource non chargée : pas une erreur JS */
        errs.push('erreur JS : ' + (e.message || '') + ' @' + (e.filename || '').split('/').pop() + ':' + (e.lineno || ''));
        save();
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        errs.push('promesse rejetée : ' + String(r && (r.stack || r.message) || r).slice(0, 200));
        save();
    });

    /* Compte les vrais window.open (nouvel onglet) : la couche app, chargée après, passe devant. */
    window.__probeNativeOpens = 0;
    var nativeOpen = window.open;
    window.open = function () {
        window.__probeNativeOpens += 1;
        return nativeOpen.apply(window, arguments);
    };

    function step(name) { try { fetch('/__npfq400-step?' + encodeURIComponent(name)); } catch (_) {} }

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function makePdf() {
        var stream = 'BT /F1 24 Tf 20 100 Td (NPF-Q400 essai) Tj ET';
        var objs = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
            '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
        ];
        var out = '%PDF-1.4\n';
        var offs = [];
        objs.forEach(function (o, i) { offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
        var x = out.length;
        out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n'
            + offs.map(function (o) { return String(o).padStart(10, '0') + ' 00000 n \n'; }).join('')
            + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF';
        return new Blob([out], { type: 'application/pdf' });
    }

    function viewerState() {
        var modal = document.getElementById('npf-pdf-viewer-modal');
        return {
            ouverte: !!(modal && getComputedStyle(modal).display !== 'none'),
            titre: (document.getElementById('npf-pdf-viewer-title') || {}).textContent || '',
            pagesDessinees: document.querySelectorAll('#npf-pdf-pages canvas').length
        };
    }

    async function testPdf(kind) {
        var r = { ongletsAvant: window.__probeNativeOpens };
        step('pdf-' + kind + '-debut');
        try {
            var blob = makePdf();
            if (kind === 'vac') {
                await window.putVacRecord({ oaci: 'LFZZ', filename: 'LFZZ.pdf', blob: blob, size: blob.size, sha256: '', cycle: '', updatedAt: Date.now(), source: 'essai' });
                await window.openVacPdf('LFZZ');
            } else {
                var db = await window.initAirportPdfDB();
                await new Promise(function (ok, ko) {
                    var tx = db.transaction(window.AIRPORT_PDF_STORE_NAME || 'airportPdfs', 'readwrite');
                    tx.objectStore(window.AIRPORT_PDF_STORE_NAME || 'airportPdfs').put({ oaci: 'LFZY', blob: blob, size: blob.size, updatedAt: Date.now() });
                    tx.oncomplete = ok; tx.onerror = function () { ko(tx.error); };
                });
                await window.openAirportPdf('LFZY');
            }
            step('pdf-' + kind + '-ouvert');
            await sleep(4000);
            var v = viewerState();
            r.visionneuse = v.ouverte;
            r.titre = v.titre;
            r.pagesDessinees = v.pagesDessinees;
            r.nouvelOnglet = window.__probeNativeOpens > r.ongletsAvant;
            if (typeof window.fermerNpfVisionneusePdf === 'function') window.fermerNpfVisionneusePdf();
        } catch (x) {
            r.erreur = String(x && x.message || x);
        }
        delete r.ongletsAvant;
        return r;
    }

    window.addEventListener('load', function () {
        setTimeout(async function () {
            var info = {};
            try {
                info.url = location.pathname + location.search;
                info.title = document.title;
                info.bootVersion = (document.querySelector('.boot-version') || {}).textContent || '';
                info.appReady = document.body.classList.contains('app-ready');
                info.mapPresent = !!document.querySelector('.leaflet-container');
                info.serviceWorkerInNavigator = 'serviceWorker' in navigator;
                info.serviceWorkerRegistrations = 'n/a';
                if (info.serviceWorkerInNavigator) {
                    try { info.serviceWorkerRegistrations = (await navigator.serviceWorker.getRegistrations()).length; } catch (x) { info.serviceWorkerRegistrations = 'erreur'; }
                    info.serviceWorkerControlled = !!navigator.serviceWorker.controller;
                }
                info.npfQ400App = window.NPF_Q400_APP ? JSON.parse(JSON.stringify(window.NPF_Q400_APP)) : null;
                info.htmlClassApp = document.documentElement.classList.contains('npf-q400-app');
                info.htmlClassInstallee = document.documentElement.classList.contains('npf-app-installee');
                info.barreHaut = getComputedStyle(document.documentElement).getPropertyValue('--npf-barre-haut').trim();
                var bar = document.getElementById('main-action-buttons');
                if (bar) { var br = bar.getBoundingClientRect(); info.boutonsHaut = Math.round(br.top); }

                step('maj-fenetre');
                /* Fenêtre « Mise à jour » de la PWA */
                info.fenetreMajVisibleApresAppel = 'fonction absente';
                if (typeof window.showUpdateReminderModal === 'function') {
                    var old = document.getElementById('update-reminder-modal'); if (old) old.remove();
                    window.showUpdateReminderModal();
                    await sleep(400);
                    var el = document.getElementById('update-reminder-modal');
                    info.fenetreMajVisibleApresAppel = !!(el && getComputedStyle(el).display !== 'none');
                    if (el) el.remove();
                }

                step('bouton-maj');
                /* Bouton MAJ : absent de TEST v17.97 ; on en pose un pour l'essai. */
                info.boutonMajDansLaPage = !!document.getElementById('force-update-button');
                var maj = document.createElement('button');
                maj.id = 'force-update-button';
                maj.className = 'force-update-button';
                maj.textContent = '🔄 MAJ';
                var reloadCalls = 0;
                var realReload = window.forceRecoveryReload;
                window.forceRecoveryReload = function () { reloadCalls += 1; };
                maj.addEventListener('click', function () { window.forceRecoveryReload(); });
                (bar || document.body).appendChild(maj);
                await sleep(100);
                info.boutonMajVisible = getComputedStyle(maj).display !== 'none';
                maj.click();
                info.boutonMajClicAgit = reloadCalls > 0;
                maj.remove();
                window.forceRecoveryReload = realReload;

                step('ecran');
                /* Écran allumé */
                info.wakeLockNatifNavigateur = Object.prototype.toString.call(navigator.wakeLock) === '[object WakeLock]';
                if (window.NPF_Q400_APP) {
                    try {
                        var s = await navigator.wakeLock.request('screen');
                        await sleep(50);
                        info.keepAwakeApresDemande = window.NPF_Q400_APP.keepAwakeLastSimulated + ' / ' + window.NPF_Q400_APP.keepAwake;
                        await s.release();
                        await sleep(50);
                        info.keepAwakeApresRelache = window.NPF_Q400_APP.keepAwakeLastSimulated + ' / ' + window.NPF_Q400_APP.keepAwake;
                        info.keepAwakeSentinelleRelachee = s.released === true;
                    } catch (x) { info.keepAwakeErreur = String(x && x.message || x); }
                }

                step('gps');
                /* GPS */
                info.geolocNatifNavigateur = Object.prototype.toString.call(navigator.geolocation) === '[object Geolocation]';
                info.survolee = ((document.getElementById('nearest-commune-display') || {}).textContent || '').trim().slice(0, 80);
                if (window.NPF_Q400_APP) {
                    try {
                        var sim = window.NPF_Q400_APP.gpsSimulationPc;
                        var g = navigator.geolocation;
                        var getPos = function (o) {
                            return new Promise(function (ok, ko) { g.getCurrentPosition(ok, ko, o); });
                        };
                        var shape = function (p) {
                            return { cles: Object.keys(p.coords).sort().join(','), coords: JSON.parse(JSON.stringify(p.coords)),
                                timestamp: p.timestamp, ageMs: Date.now() - p.timestamp };
                        };
                        var callsBefore = sim.calls.length;
                        var p1 = await getPos({ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
                        info.gpsP1 = shape(p1);
                        var p2 = await getPos({ enableHighAccuracy: true, timeout: 5000, maximumAge: 600000 });
                        info.gpsCache = { memeHeure: p2.timestamp === p1.timestamp, appelsPlugin: sim.calls.length - callsBefore };
                        await getPos({ enableHighAccuracy: false, maximumAge: 0 });
                        info.gpsOptionsPlugin = sim.calls.slice(callsBefore).map(function (c) { return c[0] + ':' + JSON.stringify(c[1]); });
                        var samples = [];
                        var wid = g.watchPosition(function (p) { samples.push({ at: Date.now(), p: shape(p) }); }, function () {},
                            { enableHighAccuracy: true, timeout: 30000, maximumAge: 600000 });
                        await sleep(5600);
                        g.clearWatch(wid);
                        var n = samples.length;
                        await sleep(1600);
                        var gaps = [];
                        for (var i = 1; i < n; i++) gaps.push(samples[i].at - samples[i - 1].at);
                        gaps.sort(function (x, y) { return x - y; });
                        info.gpsSuivi = {
                            recues: n,
                            apresArret: samples.length - n,
                            ecartMedianMs: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
                            valides: samples.filter(function (x) { return x.p.coords.speed !== null; }).map(function (x) { return x.p.coords; }),
                            invalides: samples.filter(function (x) { return x.p.coords.speed === null; }).map(function (x) { return x.p.coords; })
                        };
                        info.gpsControle = window.NPF_Q400_APP.gpsControle;
                        info.gpsStats = JSON.parse(JSON.stringify(window.NPF_Q400_APP.gpsStats));
                    } catch (x) { info.gpsErreur = String(x && x.message || x); }
                }
                step('pdf');
                /* PDF */
                info.pdfVac = await testPdf('vac');
                info.pdfTerrain = await testPdf('terrain');

                step('fin');
                step('trace');
                info.traceNavigateur = {
                    module: !!(window.NPF_Q400_APP && window.NPF_Q400_APP.trace),
                    sectionListe: !!document.getElementById('npfq400-traces-section'),
                    boutonLieParTest: (document.getElementById('yul-trace-button') || {}).dataset ? document.getElementById('yul-trace-button').dataset.bound : null,
                    boutonClasses: (document.getElementById('yul-trace-button') || { className: '' }).className,
                    clicAncreNatif: /\[native code\]/.test(String(HTMLAnchorElement.prototype.click)),
                    diagSansTrace: typeof window.buildNpfStartupDiagnosticExportText === 'function'
                        && window.buildNpfStartupDiagnosticExportText().indexOf('NPF-Q400 APP — TRACE') < 0
                };
                if (window.NPF_Q400_APP && window.NPF_Q400_APP.trace && window.NPF_Q400_APP.trace.test) {
                    var TR = window.NPF_Q400_APP.trace, X = TR.test, it = {};
                    info.trace = it;
                    try {
                        var KTMS = 1 / 1.943844;
                        var gen = function (base, segs) {
                            var pts = [], t = base, lat = 43.4367, lon = 5.2150;
                            segs.forEach(function (s) {
                                for (var i = 0; i < s.d; i++) {
                                    var mps = s.kt * KTMS, crs = (s.crs === undefined ? 335 : s.crs) * Math.PI / 180;
                                    lat += mps * Math.cos(crs) / 111320;
                                    lon += mps * Math.sin(crs) / (111320 * Math.cos(lat * Math.PI / 180));
                                    if (!s.trou) pts.push({ latitude: lat, longitude: lon, accuracy: 5, altitude: s.kt > 60 ? 600 : 30,
                                        altitudeAccuracy: 10, speed: s.sansVitesse ? null : mps, bearing: s.kt > 2 ? (s.crs === undefined ? 335 : s.crs) : null, time: t });
                                    t += 1000;
                                }
                            });
                            return { pts: pts, fin: t };
                        };
                        var btn = document.getElementById('yul-trace-button');
                        var ev = function (type) { btn.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1 })); };
                        var appuyer = async function (ms) {
                            ev('pointerdown'); await sleep(ms); ev('pointerup');
                            btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                            await sleep(150);
                        };
                        var supposeAvant = localStorage.getItem('npfTraceAssumedActive_v1');
                        var hrefAvant = location.href;
                        it.etatInitial = TR.etat;
                        it.sourceInitiale = TR.source;
                        it.boutonInitial = btn.className;

                        /* 1. Réglages : appui long */
                        await appuyer(800);
                        var w = document.getElementById('npfq400-trace-reglages');
                        it.reglagesOuverts = !!w;
                        var val = function (id) { return Number(document.getElementById(id).value); };
                        it.reglagesDefaut = w ? [val('npfq400-r-vd'), val('npfq400-r-dd'), val('npfq400-r-va'), val('npfq400-r-da'), val('npfq400-r-ma'), val('npfq400-r-ep')] : null;
                        it.paletteCouleurs = w ? w.querySelectorAll('.npfq400-couleur').length : 0;
                        it.couleurChoisieDefaut = w ? (w.querySelector('.npfq400-couleur.npfq400-choisie') || {}).getAttribute('data-c') : null;
                        if (w) {
                            document.getElementById('npfq400-r-vd').value = 60;
                            document.getElementById('npfq400-r-ep').value = 6;
                            w.querySelector('.npfq400-couleur[data-c="#6d28d9"]').click();
                            document.getElementById('npfq400-r-ok').click();
                        }
                        it.reglagesApres = JSON.parse(localStorage.getItem('npfQ400AppTraceReglagesV1') || 'null');
                        await appuyer(800);
                        document.getElementById('npfq400-r-defaut').click();
                        document.getElementById('npfq400-r-ok').click();
                        it.reglagesRemisDefaut = JSON.parse(localStorage.getItem('npfQ400AppTraceReglagesV1') || 'null');
                        it.raccourciTestPasLance = localStorage.getItem('npfTraceAssumedActive_v1') === supposeAvant && location.href === hrefAvant;

                        /* 2. Appui court : démarrage à la main, puis arrêt avec confirmation */
                        var confirmations = 0;
                        window.confirm = function () { confirmations += 1; return true; };
                        await appuyer(80);
                        it.manuelDemarre = TR.enregistrement === true && btn.classList.contains('npfq400-trace-on');
                        await appuyer(80);
                        it.manuelArrete = TR.enregistrement === false && btn.classList.contains('npfq400-trace-off') && confirmations === 1;
                        await X.sauver();
                        await sleep(300);
                        it.traceVideSupprimee = (await X.lireTraces()).length === 0;

                        /* 3. Vol complet : roulage 10 kt, décollage, remise de gaz (40 kt 20 s), écopage 75 kt,
                         *    vitesse absente 300 s (calculée), trou de 45 s, atterrissage 15 kt, arrêt. */
                        var base = Date.now() - 6 * 3600 * 1000;
                        var A = gen(base, [
                            { d: 180, kt: 10 }, { d: 600, kt: 120 }, { d: 20, kt: 40 }, { d: 60, kt: 75 },
                            { d: 300, kt: 120, sansVitesse: true }, { d: 45, kt: 120, trou: true }, { d: 120, kt: 120 },
                            { d: 200, kt: 15 }, { d: 60, kt: 0 }
                        ]);
                        var t0 = performance.now();
                        X.injecter(A.pts);
                        it.msParPoint = Math.round((performance.now() - t0) / A.pts.length * 1000) / 1000;
                        await X.sauver();
                        await sleep(300);
                        var traces = await X.lireTraces();
                        var trA = traces.filter(function (t) { return t.debut >= base; }).sort(function (a, b) { return a.debut - b.debut; })[0];
                        it.volA = trA ? {
                            etat: trA.etat, mode: trA.mode, points: trA.points, trous: trA.trous.length,
                            debutApresBase_s: Math.round((trA.debut - base) / 1000),
                            finApresBase_s: Math.round((trA.fin - base) / 1000),
                            une: traces.filter(function (t) { return t.debut >= base && t.debut < A.fin; }).length
                        } : null;
                        var pA = trA ? await X.lirePoints(trA.id) : { pts: [] };
                        it.volA_pointsLus = pA.pts.length;
                        it.volA_vitesseCalculee = pA.pts.filter(function (q) { return q[7] === 1; }).length;
                        it.volA_capRoute = pA.pts.filter(function (q) { return q[5] === 335; }).length;

                        /* 4. Arrêt à la main en vol : pas de redémarrage avant l'atterrissage */
                        var b2 = A.fin + 600000;
                        var B1 = gen(b2, [{ d: 60, kt: 10 }, { d: 200, kt: 120 }]);
                        X.injecter(B1.pts);
                        it.volB_demarre = TR.enregistrement === true;
                        await appuyer(80); /* arrêt à la main (confirmation acceptée) */
                        var B2 = gen(B1.fin, [{ d: 120, kt: 120 }]);
                        X.injecter(B2.pts);
                        it.volB_pasRedemarreEnVol = TR.enregistrement === false;
                        var B3 = gen(B2.fin, [{ d: 150, kt: 15 }, { d: 20, kt: 10 }, { d: 60, kt: 120 }]);
                        X.injecter(B3.pts);
                        it.volB_redemarreApresAtterrissage = TR.enregistrement === true;
                        var B4 = gen(B3.fin, [{ d: 150, kt: 10 }]);
                        X.injecter(B4.pts);
                        it.volB_arreteAuto = TR.enregistrement === false;
                        await X.sauver();

                        /* 5. Mémoire bornée : 30 min de roulage armé (tampon), puis 1 h de vol */
                        var b5 = B4.fin + 600000;
                        var C1 = gen(b5, [{ d: 1800, kt: 8 }]);
                        X.injecter(C1.pts);
                        it.tamponApresRoulage = X.moteur.tampon.length;
                        var C2 = gen(C1.fin, [{ d: 3600, kt: 130 }]);
                        var t1 = performance.now();
                        X.injecter(C2.pts);
                        it.msParPointVol1h = Math.round((performance.now() - t1) / C2.pts.length * 1000) / 1000;
                        it.enAttenteMax = X.moteur.attente.length;
                        it.morceauxTrait = X.traitMorceaux();
                        it.pointsDessines = it.morceauxTrait.reduce(function (s, m) { return s + m.n; }, 0);
                        it.pointsTraceC = TR.traceEnCours ? TR.traceEnCours.points : null;
                        await X.sauver();
                        await sleep(300);
                        var lotsC = await (async function () {
                            var tc = TR.traceEnCours;
                            var r = await X.lirePoints(tc.id);
                            return { points: r.pts.length, lots: r.dernierSeq + 1 };
                        })();
                        it.lotsC = lotsC;

                        /* 6. Arrêt brutal pendant le vol C (points en attente perdus), puis relancement :
                         *    la trace est retrouvée et close (dernier point trop ancien), avec un message. */
                        var idC = TR.traceEnCours ? TR.traceEnCours.id : null;
                        var C3 = gen(C2.fin, [{ d: 20, kt: 130 }]);
                        X.injecter(C3.pts);
                        it.perdusArretBrutal = X.arretBrutal();
                        await X.relancer();
                        await sleep(300);
                        var tracesR = await X.lireTraces();
                        var trC = tracesR.filter(function (t) { return t.id === idC; })[0];
                        it.repriseC = trC ? { etat: trC.etat, points: trC.points } : null;
                        it.messageReprise = (TR.messages[TR.messages.length - 1] || {}).texte || '';
                        it.enregistrementApresReprise = TR.enregistrement;

                        /* 6 bis. iPad immobile : plus aucun point après le début de l'atterrissage → arrêt à l'horloge */
                        var bE = Date.now() - 300000;
                        var Ev = gen(bE, [{ d: 20, kt: 10 }, { d: 100, kt: 120 }, { d: 30, kt: 15 }]);
                        X.injecter(Ev.pts);
                        it.volE_enregistreSansPointsRecents = TR.enregistrement === true;
                        it.volE_arreteHorloge = X.verifierArret() === false;
                        await X.sauver();

                        /* 7. Relancement pendant un vol récent : la trace continue */
                        var b7 = Date.now() - 100000;
                        var D = gen(b7, [{ d: 20, kt: 10 }, { d: 80, kt: 120 }]);
                        X.injecter(D.pts);
                        it.volD_demarre = TR.enregistrement === true;
                        await X.sauver();
                        await X.relancer();
                        it.volD_continue = TR.enregistrement === true && (TR.messages[TR.messages.length - 1] || {}).texte.indexOf('continue') >= 0;
                        it.volD_traitRedessine = X.traitMorceaux().length > 0;
                        await appuyer(80);
                        it.volD_arrete = TR.enregistrement === false;
                        await X.sauver();

                        /* 7 bis. Lot écrit mais fiche en échec (iOS suspend l'app) : pas de point en double ;
                         *        et un même point écrit deux fois n'est lu qu'une fois */
                        var bF = Date.now() + 3600000;
                        var Fv = gen(bF, [{ d: 130, kt: 10 }, { d: 60, kt: 120 }]); /* 130 s au sol : réarmement après l arrêt à la main du vol D */
                        X.injecter(Fv.pts);
                        var idF = TR.traceEnCours ? TR.traceEnCours.id : null;
                        X.echecFicheUneFois = true;
                        await X.sauver();
                        var Fv2 = gen(Fv.fin, [{ d: 40, kt: 120 }]);
                        X.injecter(Fv2.pts);
                        await X.sauver();
                        var lusF = await X.lirePoints(idF);
                        await X.ajouterLotBrut(idF, 999, lusF.pts.slice(0, 10));
                        var lusF2 = await X.lirePoints(idF);
                        var attendusF = TR.traceEnCours ? TR.traceEnCours.points : null;
                        it.volF = { attendus: attendusF, lus: lusF.pts.length, lusApresDoublons: lusF2.pts.length,
                            erreurNotee: /échec simulé/.test(TR.erreurSauvegarde || '') };
                        await appuyer(80);

                        /* 8. GPX du vol A */
                        var g = await X.gpx(trA.id);
                        var doc = new DOMParser().parseFromString(g.texte, 'application/xml');
                        var racine = doc.documentElement;
                        it.gpx = {
                            nom: g.nom,
                            xmlValide: !doc.getElementsByTagName('parsererror').length,
                            racine: racine.nodeName, version: racine.getAttribute('version'),
                            espace: racine.namespaceURI,
                            trkpt: doc.getElementsByTagName('trkpt').length,
                            trkseg: doc.getElementsByTagName('trkseg').length,
                            ele: doc.getElementsByTagName('ele').length,
                            time: doc.getElementsByTagName('time').length,
                            vitesse: doc.getElementsByTagNameNS('http://www.garmin.com/xmlschemas/TrackPointExtension/v2', 'speed').length,
                            premiereHeure: (doc.querySelector('trkpt time') || {}).textContent,
                            nomAttendu: 'NPF-Q400_trace_' + new Date(trA.debut).toISOString().slice(0, 10) + '_' + new Date(trA.debut).toISOString().slice(11, 13) + new Date(trA.debut).toISOString().slice(14, 16) + 'Z.gpx'
                        };
                        await X.exporter(trA.id);
                        it.gpxPartage = TR.partageSimule ? TR.partageSimule.nom : null;

                        /* 9. Afficher une trace passée, liste dans « Gestion des Cartes » */
                        await X.afficher(trA.id);
                        it.afficher = TR.traceAffichee;
                        X.masquer();
                        await X.ordre({ action: 'liste' });
                        await sleep(800);
                        var lis = document.querySelectorAll('#npfq400-traces-liste .npfq400-trace-item');
                        it.liste = {
                            lignes: lis.length,
                            texte: lis.length ? lis[0].querySelector('.npfq400-trace-info').textContent : '',
                            boutons: lis.length ? Array.prototype.map.call(lis[0].querySelectorAll('button'), function (b) { return b.textContent; }) : []
                        };
                        await X.ordre({ action: 'fermer' });

                        /* 10. DIAG */
                        var diagTexte = window.buildNpfStartupDiagnosticExportText();
                        it.diag = diagTexte.split('\n').filter(function (l) { return /^Trace|^Dernière trace|^Réglages Trace|NPF-Q400 APP — TRACE/.test(l); });

                        /* 11. Partage iPad des fichiers DIAG, KML et CSV feu */
                        var partage = async function (nom, type) {
                            TR.partageSimule = null;
                            var a = document.createElement('a');
                            a.href = URL.createObjectURL(new Blob(['contenu ' + nom], { type: type }));
                            a.download = nom;
                            a.click();
                            await sleep(300);
                            return TR.partageSimule ? TR.partageSimule.nom + ' | ' + TR.partageSimule.texte : null;
                        };
                        it.partageKml = await partage('POINT_TEST.kml', 'application/vnd.google-earth.kml+xml');
                        it.partageCsv = await partage('Fichier_cibles_NEXT_TEST.csv', 'text/csv');
                        TR.partageSimule = null;
                        await navigator.share({ title: 'DIAG', files: [new File(['diag'], 'NPF_DIAG_2026-11-17_10-00.txt', { type: 'text/plain' })] });
                        it.partageDiag = TR.partageSimule ? TR.partageSimule.nom : null;
                        it.canShareDiag = navigator.canShare({ files: [new File(['d'], 'NPF_DIAG_x.txt')] });
                        it.messages = TR.messages.map(function (m) { return m.texte; });
                    } catch (x) { it.erreur = String(x && (x.stack || x.message) || x).slice(0, 400); }
                }
                var hosts = {};
                performance.getEntriesByType('resource').forEach(function (p) {
                    try { var h = new URL(p.name).hostname; if (h !== '127.0.0.1') hosts[h] = 1; } catch (_) {}
                });
                info.externalHostsTried = Object.keys(hosts).sort();
                if (window.NPF_Q400_APP) info.npfQ400AppFin = JSON.parse(JSON.stringify(window.NPF_Q400_APP));
            } catch (x) { errs.push('sonde : ' + x.message); }
            info.jsErrors = errs;
            fetch('/__npfq400-report', { method: 'POST', body: JSON.stringify(info) });
        }, __WAIT_MS__);
    });
})();
