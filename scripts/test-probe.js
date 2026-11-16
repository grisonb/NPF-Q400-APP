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

                step('pdf');
                /* PDF */
                info.pdfVac = await testPdf('vac');
                info.pdfTerrain = await testPdf('terrain');

                step('fin');
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
