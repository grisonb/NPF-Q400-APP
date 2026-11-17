/*
 * NPF-Q400 APP — enregistrement de la trace de vol (version 0.5.2).
 *
 * Fichier ajouté par scripts/build-www.mjs juste après npf-q400-app.js. Il ne fait RIEN
 * hors de l'app (pas de window.NPF_Q400_APP) : dans un navigateur normal, le bouton TRACE
 * garde son comportement de NPF-Q400 TEST (raccourci « NPF Trace »).
 *
 * Dans l'app :
 *  - source : plugin @capgo/background-geolocation, lancé dès l'ouverture de l'app, qui
 *    continue en arrière-plan et écran verrouillé (type d'activité « avion », pause
 *    automatique d'iOS désactivée). Le GPS de la CARTE reste celui de la 0.4
 *    (npf-q400-app.js, section 7) : deux flux séparés, la carte ne change pas ;
 *  - chaque position est aussi écrite par iOS dans le journal natif du plugin : au retour au
 *    premier plan, toutes les 30 s et au relancement après un arrêt brutal, les points
 *    manquants y sont repris (rien n'est perdu si iOS endort la page) ;
 *  - démarrage / arrêt automatiques (réglables), mémoire tampon des minutes d'avant ;
 *  - points enregistrés par lots (IndexedDB « npfQ400AppTracesV1 ») au moins toutes les 30 s ;
 *  - bouton TRACE : rouge = enregistrement, gris = arrêté ; appui court = démarrer /
 *    arrêter (confirmation pour l'arrêt) ; appui long = « Réglages Trace » ;
 *  - trait de la trace en cours sur la carte, ajouté par petits morceaux (pas de redessin
 *    complet) ; traces passées dans « Gestion des Cartes » : Afficher, Exporter (GPX),
 *    Supprimer ;
 *  - partage iPad (Fichiers, AirDrop, Mail) pour le GPX et, dans l'app, pour les fichiers
 *    DIAG, KML et CSV feu de la PWA ;
 *  - lignes « Trace » dans l'export DIAG.
 */
(function npfQ400AppTrace() {
    'use strict';

    var APP = window.NPF_Q400_APP;
    if (!APP || !APP.isApp) return; /* navigateur normal : rien */

    var VERSION = '0.5.2';
    var cap = window.Capacitor;
    var NATIVE = !!(cap && typeof cap.nativePromise === 'function' && typeof cap.nativeCallback === 'function');
    var SIM = APP.detectedBy === 'simulation-pc';
    var DEBUG = !!(cap && cap.DEBUG === true);
    var KT = 1.943844; /* m/s -> nœuds */

    var T = {
        version: VERSION,
        etat: 'démarrage',
        source: 'non lancée',
        sourceErreur: '',
        pointsRecus: 0,
        pointsJournal: 0,
        pointsIgnores: 0,
        enregistrement: false,
        traceEnCours: null,
        derniereTrace: null,
        messages: [],
        partages: []
    };
    APP.trace = T;

    function log(evt, data) {
        var o = { evt: evt, t: Date.now() };
        if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) o[k] = data[k];
        try { console.info('[NPF-Q400 APP] trace ' + JSON.stringify(o)); } catch (_) {}
    }
    function diagMark(label, detail) {
        try {
            var d = window.NPF_STARTUP_DIAGNOSTIC;
            if (d && typeof d.mark === 'function') {
                d.mark('npfq400app_trace_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), 'Trace — ' + label, detail || '');
            }
        } catch (_) {}
    }
    function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
    function utcHM(t) { var d = new Date(t); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + 'Z'; }
    function utcHMS(t) { var d = new Date(t); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z'; }
    function utcDate(t) { var d = new Date(t); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
    function frDate(t) { var d = new Date(t); return pad(d.getUTCDate()) + '/' + pad(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); }
    function duree(ms) {
        var m = Math.max(0, Math.round(ms / 60000));
        return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min';
    }
    function distM(aLat, aLon, bLat, bLon) {
        var r = Math.PI / 180;
        var dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /* =========================================================== réglages */
    var DEFAUTS = {
        vitesseDemarrageKt: 50,
        dureeDemarrageS: 30,
        vitesseArretKt: 30,
        dureeArretMin: 2,
        minutesAvant: 2,
        couleur: '#1e3a8a',
        epaisseur: 4
    };
    /* Palette : aucune couleur proche de la ligne rouge ni du vecteur jaune de la PWA. */
    var PALETTE = [
        { c: '#1e3a8a', n: 'Bleu foncé' },
        { c: '#0e7490', n: 'Bleu canard' },
        { c: '#6d28d9', n: 'Violet' },
        { c: '#be185d', n: 'Framboise' },
        { c: '#166534', n: 'Vert foncé' },
        { c: '#111827', n: 'Noir' },
        { c: '#ffffff', n: 'Blanc' }
    ];
    var CLE_REGLAGES = 'npfQ400AppTraceReglagesV1';
    function borne(v, min, max, def) {
        v = Number(v);
        if (!isFinite(v)) return def;
        return Math.min(max, Math.max(min, v));
    }
    function nettoyerReglages(r) {
        r = r || {};
        var o = {
            vitesseDemarrageKt: Math.round(borne(r.vitesseDemarrageKt, 10, 250, DEFAUTS.vitesseDemarrageKt)),
            dureeDemarrageS: Math.round(borne(r.dureeDemarrageS, 0, 600, DEFAUTS.dureeDemarrageS)),
            vitesseArretKt: Math.round(borne(r.vitesseArretKt, 5, 200, DEFAUTS.vitesseArretKt)),
            dureeArretMin: Math.round(borne(r.dureeArretMin, 0.5, 30, DEFAUTS.dureeArretMin) * 2) / 2,
            minutesAvant: Math.round(borne(r.minutesAvant, 0, 10, DEFAUTS.minutesAvant) * 2) / 2,
            couleur: /^#[0-9a-f]{6}$/i.test(String(r.couleur || '')) ? String(r.couleur).toLowerCase() : DEFAUTS.couleur,
            epaisseur: Math.round(borne(r.epaisseur, 1, 12, DEFAUTS.epaisseur))
        };
        /* L'arrêt doit se faire plus lentement que le démarrage. */
        if (o.vitesseArretKt >= o.vitesseDemarrageKt) o.vitesseArretKt = Math.max(5, o.vitesseDemarrageKt - 5);
        return o;
    }
    function lireReglages() {
        var r = null;
        try { r = JSON.parse(localStorage.getItem(CLE_REGLAGES) || 'null'); } catch (_) {}
        return nettoyerReglages(r || DEFAUTS);
    }
    function ecrireReglages(r) {
        R = nettoyerReglages(r);
        try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(R)); } catch (_) {}
        T.reglages = R;
        restylerTraits();
        log('reglages', { reglages: R });
        return R;
    }
    var R = lireReglages();
    T.reglages = R;

    /* =========================================================== stockage */
    var DB_NOM = 'npfQ400AppTracesV1';
    var dbPromise = null;
    function db() {
        if (!dbPromise) {
            dbPromise = new Promise(function (ok, ko) {
                var req = indexedDB.open(DB_NOM, 1);
                req.onupgradeneeded = function () {
                    var d = req.result;
                    if (!d.objectStoreNames.contains('traces')) d.createObjectStore('traces', { keyPath: 'id' });
                    if (!d.objectStoreNames.contains('lots')) {
                        var s = d.createObjectStore('lots', { keyPath: 'k', autoIncrement: true });
                        s.createIndex('trace', 'traceId', { unique: false });
                    }
                };
                req.onsuccess = function () { ok(req.result); };
                req.onerror = function () { ko(req.error); };
            });
        }
        return dbPromise;
    }
    function tx(stores, mode, fn) {
        return db().then(function (d) {
            return new Promise(function (ok, ko) {
                var t = d.transaction(stores, mode);
                var res;
                try { res = fn(t); } catch (e) { ko(e); return; }
                t.oncomplete = function () { ok(res && res.result !== undefined ? res.result : res); };
                t.onerror = function () { ko(t.error); };
                t.onabort = function () { ko(t.error || new Error('transaction annulée')); };
            });
        });
    }
    function sauverMeta(meta) {
        var copie = JSON.parse(JSON.stringify(meta));
        return tx(['traces'], 'readwrite', function (t) { t.objectStore('traces').put(copie); });
    }
    function ajouterLot(traceId, seq, pts) {
        return tx(['lots'], 'readwrite', function (t) { t.objectStore('lots').add({ traceId: traceId, seq: seq, pts: pts }); });
    }
    function lireTraces() {
        return tx(['traces'], 'readonly', function (t) { return t.objectStore('traces').getAll(); })
            .then(function (l) { return (l || []).sort(function (a, b) { return b.id - a.id; }); });
    }
    function lirePoints(traceId) {
        return tx(['lots'], 'readonly', function (t) { return t.objectStore('lots').index('trace').getAll(traceId); })
            .then(function (lots) {
                lots = (lots || []).sort(function (a, b) { return a.seq - b.seq; });
                var pts = [];
                lots.forEach(function (l) { for (var i = 0; i < l.pts.length; i++) pts.push(l.pts[i]); });
                /* dans l'ordre des heures, sans doublon (sécurité : un même point écrit deux fois) */
                pts.sort(function (a, b) { return a[0] - b[0]; });
                var uniques = [];
                for (var j = 0; j < pts.length; j++) {
                    if (!uniques.length || pts[j][0] > uniques[uniques.length - 1][0]) uniques.push(pts[j]);
                }
                pts = uniques;
                return { pts: pts, dernierSeq: lots.length ? lots[lots.length - 1].seq : -1 };
            });
    }
    function supprimerTrace(traceId) {
        return tx(['traces', 'lots'], 'readwrite', function (t) {
            t.objectStore('traces').delete(traceId);
            var idx = t.objectStore('lots').index('trace');
            idx.openKeyCursor(IDBKeyRange.only(traceId)).onsuccess = function (e) {
                var c = e.target.result;
                if (c) { t.objectStore('lots').delete(c.primaryKey); c.continue(); }
            };
        });
    }

    /* =========================================================== moteur */
    /* Point compact enregistré : [heure ms, lat, lon, altitude m | null, vitesse m/s | null,
     * route ° | null, précision m | null, vitesse calculée 1 | 0]. */
    var E = {
        dernierT: 0,
        prec: null,
        tampon: [],
        auDessusDepuis: null,
        enDessousDepuis: null,
        autoPermis: true,
        trace: null,
        attente: [],
        attenteDebutT: 0,
        seq: 0,
        sauvegarde: Promise.resolve()
    };

    function normaliser(d) {
        if (!d) return null;
        var lat = Number(d.latitude), lon = Number(d.longitude);
        if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
        var t = Number(d.time || d.timestamp);
        if (!isFinite(t) || t <= 0) t = Date.now();
        var vAcc = Number(d.altitudeAccuracy);
        var spd = d.speed === null || d.speed === undefined ? null : Number(d.speed);
        var crs = d.bearing === null || d.bearing === undefined ? null : Number(d.bearing);
        var acc = Number(d.accuracy);
        return {
            t: Math.round(t),
            lat: lat,
            lon: lon,
            alt: isFinite(vAcc) && vAcc >= 0 && isFinite(Number(d.altitude)) ? Number(d.altitude) : null,
            spd: spd !== null && isFinite(spd) && spd >= 0 ? spd : null,
            crs: crs !== null && isFinite(crs) && crs >= 0 ? crs : null,
            acc: isFinite(acc) && acc >= 0 ? acc : null,
            calc: 0
        };
    }

    function ingerer(d, origine) {
        var p = normaliser(d);
        if (!p) { T.pointsIgnores += 1; return; }
        if (p.t <= E.dernierT) { T.pointsIgnores += 1; return; } /* déjà reçu (journal + direct) */
        if (origine === 'journal') T.pointsJournal += 1;
        T.pointsRecus += 1;

        /* vitesse : celle du GPS, sinon calculée à partir de la position précédente */
        var prec = E.prec;
        if (p.spd === null && prec) {
            var dt = (p.t - prec.t) / 1000;
            if (dt >= 0.5 && dt <= 30) {
                p.spd = distM(prec.lat, prec.lon, p.lat, p.lon) / dt;
                p.calc = 1;
            }
        }
        var kt = p.spd === null ? null : p.spd * KT;
        E.prec = p;
        E.dernierT = p.t;
        T.dernierPointRecu = { t: p.t, kt: kt === null ? null : Math.round(kt * 10) / 10 };

        if (kt !== null) {
            if (kt >= R.vitesseDemarrageKt) { if (E.auDessusDepuis === null) E.auDessusDepuis = p.t; }
            else E.auDessusDepuis = null;
            if (kt < R.vitesseArretKt) { if (E.enDessousDepuis === null) E.enDessousDepuis = p.t; }
            else E.enDessousDepuis = null;
        }
        var auDessus = E.auDessusDepuis !== null && p.t - E.auDessusDepuis >= R.dureeDemarrageS * 1000;
        var arrete = E.enDessousDepuis !== null && p.t - E.enDessousDepuis >= R.dureeArretMin * 60000;

        if (E.trace) {
            ajouterPoint(p);
            if (!E.trace.aVole && auDessus) {
                E.trace.aVole = true; /* une trace démarrée à la main devient « en vol » */
                metaModifiee = true;
            }
            if (E.trace.aVole && arrete) arreter('auto');
        } else {
            E.tampon.push(p);
            var garde = (R.minutesAvant * 60 + R.dureeDemarrageS) * 1000 + 10000;
            while (E.tampon.length && E.tampon[0].t < p.t - garde) E.tampon.shift();
            if (!E.autoPermis && arrete) {
                E.autoPermis = true; /* après un arrêt à la main en vol : réarmé une fois posé */
                log('rearme', {});
            }
            if (E.autoPermis && auDessus) demarrer('auto');
        }
        rafraichirBouton();
    }

    var metaModifiee = false;

    function demarrer(mode) {
        if (E.trace) return;
        var depuis;
        if (mode === 'auto') depuis = (E.auDessusDepuis || E.dernierT) - R.minutesAvant * 60000;
        else depuis = E.dernierT || Date.now();
        var avant = E.tampon.filter(function (p) { return p.t >= depuis; });
        E.tampon = [];
        var debut = avant.length ? avant[0].t : (E.dernierT || Date.now());
        E.trace = {
            id: debut,
            debut: debut,
            fin: debut,
            points: 0,
            etat: 'en cours',
            mode: mode,
            aVole: mode === 'auto',
            trous: [],
            reglages: JSON.parse(JSON.stringify(R)),
            app: VERSION,
            creeLe: Date.now()
        };
        E.seq = 0;
        E.attente = [];
        E.attenteDebutT = 0;
        traitNeuf();
        avant.forEach(function (p) { ajouterPoint(p); });
        T.enregistrement = true;
        T.traceEnCours = resume(E.trace);
        metaModifiee = true;
        sauver(true);
        log('demarrage', { mode: mode, debut: E.trace.debut, pointsAvant: avant.length });
        diagMark(mode === 'auto' ? 'démarrage automatique' : 'démarrage à la main',
            'début ' + utcHMS(E.trace.debut) + ' · ' + avant.length + ' points d’avant');
        rafraichirBouton();
        rafraichirListe();
    }

    function arreter(raison) {
        var tr = E.trace;
        if (!tr) return Promise.resolve();
        tr.etat = raison === 'retrouvée' ? 'retrouvée' : 'terminée';
        tr.raisonArret = raison;
        E.trace = null;
        T.enregistrement = false;
        T.traceEnCours = null;
        T.derniereTrace = resume(tr);
        E.autoPermis = raison !== 'manuel'; /* arrêt à la main en vol : pas de redémarrage avant l'atterrissage */
        E.tampon = [];
        metaModifiee = true;
        if (tr.points === 0) {
            /* démarrée puis arrêtée sans aucun point : rien à garder */
            E.attente = [];
            metaModifiee = false;
            T.derniereTrace = null;
            log('arret', { raison: raison, debut: tr.debut, points: 0, vide: true });
            rafraichirBouton();
            var pv = E.sauvegarde.then(function () { return supprimerTrace(tr.id); }).catch(function () {});
            pv.then(rafraichirListe, rafraichirListe);
            return pv;
        }
        var p = sauver(true, tr);
        log('arret',{ raison: raison, debut: tr.debut, fin: tr.fin, points: tr.points, trous: tr.trous.length });
        diagMark(raison === 'auto' ? 'arrêt automatique' : (raison === 'manuel' ? 'arrêt à la main' : 'trace retrouvée et close'),
            utcHMS(tr.debut) + ' → ' + utcHMS(tr.fin) + ' · ' + tr.points + ' points · ' + tr.trous.length + ' trou(s) > 30 s');
        rafraichirBouton();
        p.then(rafraichirListe, rafraichirListe);
        return p;
    }

    function ajouterPoint(p) {
        var tr = E.trace;
        if (tr.points > 0 && p.t - tr.fin > 30000) {
            tr.trous.push([tr.fin, p.t]);
            log('trou', { de: tr.fin, a: p.t, s: Math.round((p.t - tr.fin) / 1000) });
            diagMark('trou de ' + Math.round((p.t - tr.fin) / 1000) + ' s', utcHMS(tr.fin) + ' → ' + utcHMS(p.t));
        }
        if (!E.attente.length) E.attenteDebutT = p.t;
        E.attente.push([p.t, round(p.lat, 7), round(p.lon, 7), p.alt === null ? null : round(p.alt, 1),
            p.spd === null ? null : round(p.spd, 2), p.crs === null ? null : round(p.crs, 1),
            p.acc === null ? null : round(p.acc, 1), p.calc]);
        tr.points += 1;
        tr.fin = p.t;
        if (tr.points === 1) tr.debut = p.t;
        traitAjouter(p);
        T.traceEnCours = resume(tr);
        /* lot au moins toutes les 30 s (heure des points) — 25 s par prudence */
        if (p.t - E.attenteDebutT >= 25000) sauver(false);
    }
    function round(v, n) { var f = Math.pow(10, n); return Math.round(v * f) / f; }
    function resume(tr) {
        return {
            id: tr.id, debut: tr.debut, fin: tr.fin, points: tr.points, mode: tr.mode, etat: tr.etat,
            trous: tr.trous.length, aVole: tr.aVole
        };
    }

    /* Sauvegarde sérialisée : un lot (points en attente) + la fiche de la trace. */
    function sauver(force, traceFinie) {
        var tr = traceFinie || E.trace;
        if (!tr) return E.sauvegarde;
        if (!E.attente.length && !metaModifiee && !force) return E.sauvegarde;
        var pts = E.attente;
        var seq = E.seq;
        if (pts.length) E.seq += 1;
        E.attente = [];
        E.attenteDebutT = 0;
        metaModifiee = false;
        var meta = JSON.parse(JSON.stringify(tr));
        meta.maj = Date.now();
        var lotEcrit = !pts.length;
        E.sauvegarde = E.sauvegarde.then(function () {
            return (pts.length ? ajouterLot(tr.id, seq, pts) : Promise.resolve()).then(function () {
                lotEcrit = true;
                if (SIM && T.test && T.test.echecFicheUneFois) { T.test.echecFicheUneFois = false; throw new Error('échec simulé de la fiche'); }
                return sauverMeta(meta);
            });
        }).then(function () {
            T.derniereSauvegarde = { t: Date.now(), points: pts.length, total: meta.points };
            if (pts.length) log('lot', { trace: tr.id, seq: seq, points: pts.length, total: meta.points });
        }).catch(function (e) {
            T.erreurSauvegarde = String(e && e.message || e);
            log('erreur-sauvegarde', { message: T.erreurSauvegarde, lotEcrit: lotEcrit });
            if (!lotEcrit && pts.length && E.trace && E.trace.id === tr.id) {
                /* le lot n'a pas été écrit : ses points repartent en tête de file */
                E.attente = pts.concat(E.attente);
            } else if (E.trace && E.trace.id === tr.id) {
                /* lot écrit, seule la fiche a échoué (ex. iOS a suspendu l'app) : on ne
                 * réécrit pas les points (doublons, vus en 0.5.1), on refera la fiche */
                metaModifiee = true;
            } else if (lotEcrit) {
                /* trace déjà close : on retente la fiche seule */
                E.sauvegarde = E.sauvegarde.then(function () { return sauverMeta(meta); }).catch(function () {});
            }
        });
        return E.sauvegarde;
    }
    /* filet de sécurité : sauvegarde au moins toutes les 15 s (horloge), même si les points tardent */
    setInterval(function () { if (E.trace) sauver(false); }, 15000);

    /* Arrêt (et réarmement) aussi à l'HORLOGE : iPad immobile au parking, iOS peut ne plus
     * envoyer aucune position (vu dans le simulateur, 0.5). Seulement si l'atterrissage a
     * commencé (vitesse sous la vitesse d'arrêt), si aucun point n'est arrivé depuis 10 s et
     * si le journal natif a été repris (sinon on attend : des points peuvent y être). */
    function verifierArretHorloge() {
        if (enAttenteDeRattrapage || rattrapageEnCours) return;
        if (E.enDessousDepuis === null) return;
        var maintenant = Date.now();
        if (maintenant - E.dernierT < 10000) return;
        if (maintenant - E.enDessousDepuis < R.dureeArretMin * 60000) return;
        if (E.trace && E.trace.aVole) {
            log('arret-horloge', { silenceS: Math.round((maintenant - E.dernierT) / 1000) });
            arreter('auto');
        } else if (!E.trace && !E.autoPermis) {
            E.autoPermis = true;
            log('rearme', { horloge: true });
        }
    }
    setInterval(verifierArretHorloge, 5000);

    /* =========================================================== source native */
    var journalId = 0;
    try { journalId = Number(localStorage.getItem('npfQ400AppTraceJournalIdV1')) || 0; } catch (_) {}
    var enAttenteDeRattrapage = true; /* au démarrage : le journal natif passe d'abord */
    var fileDirecte = [];
    var rattrapageEnCours = null;

    function recevoirDirect(d) {
        if (enAttenteDeRattrapage) {
            fileDirecte.push(d);
            if (fileDirecte.length > 20000) fileDirecte.shift();
            return;
        }
        ingerer(d, 'direct');
    }

    function lancerSource() {
        if (!NATIVE) {
            T.source = SIM ? 'simulée (essais PC)' : 'indisponible (pont natif absent)';
            return;
        }
        try {
            cap.nativeCallback('BackgroundGeolocation', 'start', {
                backgroundMessage: 'NPF-Q400 APP enregistre la trace de vol.',
                backgroundTitle: 'NPF-Q400 APP',
                requestPermissions: true,
                stale: false,
                distanceFilter: 0,
                activityType: 'airborne',
                locationLog: true,
                locationLogMaxEntries: 30000
            }, function (data, err) {
                if (err) {
                    T.source = 'erreur';
                    T.sourceErreur = String(err.message || err.code || err).slice(0, 160);
                    log('source-erreur', { message: T.sourceErreur, code: err.code || '' });
                    diagMark('erreur de la source GPS d’arrière-plan', T.sourceErreur);
                    return;
                }
                if (T.source !== 'active') {
                    T.source = 'active';
                    log('source-active', {});
                }
                recevoirDirect(data);
            });
            T.source = 'lancée (en attente de l’autorisation ou du premier point)';
        } catch (e) {
            T.source = 'erreur';
            T.sourceErreur = String(e && e.message || e);
        }
    }

    /* Reprise du journal natif : points reçus par iOS mais pas (ou pas encore) par la page. */
    function rattraper(raison) {
        if (rattrapageEnCours) return rattrapageEnCours;
        if (!NATIVE) {
            enAttenteDeRattrapage = false;
            var f0 = fileDirecte; fileDirecte = [];
            f0.forEach(function (d) { ingerer(d, 'direct'); });
            return Promise.resolve(0);
        }
        enAttenteDeRattrapage = true;
        var repris = 0;
        function tour() {
            return cap.nativePromise('BackgroundGeolocation', 'getLocationLog', { afterId: journalId, limit: 2000 })
                .then(function (res) {
                    var entrees = (res && res.entries) || [];
                    entrees.sort(function (a, b) { return Number(a.id) - Number(b.id); });
                    entrees.forEach(function (e) {
                        var avant = T.pointsRecus;
                        ingerer(e, 'journal');
                        if (T.pointsRecus > avant) repris += 1;
                        if (Number(e.id) > journalId) journalId = Number(e.id);
                    });
                    try { localStorage.setItem('npfQ400AppTraceJournalIdV1', String(journalId)); } catch (_) {}
                    if (entrees.length >= 2000) return tour();
                    return null;
                });
        }
        rattrapageEnCours = tour().then(function () {
            /* le journal ne garde que ce qui n'a pas encore été lu */
            return cap.nativePromise('BackgroundGeolocation', 'clearLocationLog', { upToId: journalId }).catch(function () {});
        }).catch(function (e) {
            T.journalErreur = String(e && e.message || e).slice(0, 160);
        }).then(function () {
            enAttenteDeRattrapage = false;
            var f = fileDirecte; fileDirecte = [];
            f.forEach(function (d) { ingerer(d, 'direct'); });
            if (repris) {
                log('rattrapage', { raison: raison, points: repris });
                diagMark('points repris du journal natif', repris + ' points (' + raison + ')');
            }
            T.dernierRattrapage = { t: Date.now(), raison: raison, points: repris };
            rattrapageEnCours = null;
            if (E.trace) sauver(false);
            return repris;
        });
        return rattrapageEnCours;
    }

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            if (E.trace) sauver(true);
            enAttenteDeRattrapage = NATIVE; /* au retour : le journal d'abord, dans l'ordre */
            log('arriere-plan', { points: E.trace ? E.trace.points : 0 });
        } else {
            log('premier-plan', {});
            rattraper('retour au premier plan');
        }
    });
    window.addEventListener('pagehide', function () { if (E.trace) sauver(true); });
    setInterval(function () {
        if (document.visibilityState === 'visible') rattraper('contrôle 30 s');
    }, 30000);

    /* État toutes les 30 s dans la console (DIAG / essais simulateur). */
    setInterval(function () {
        log('etat', {
            enregistrement: T.enregistrement,
            points: E.trace ? E.trace.points : 0,
            recus: T.pointsRecus,
            journal: T.pointsJournal,
            dernier: T.dernierPointRecu || null,
            source: T.source
        });
    }, 30000);

    /* =========================================================== reprise au démarrage */
    function demarrage() {
        T.etat = 'reprise';
        return lireTraces().then(function (traces) {
            T.nombreTraces = traces.length;
            var enCours = traces.filter(function (t) { return t.etat === 'en cours'; });
            /* plusieurs « en cours » (ne devrait pas arriver) : on garde la plus récente */
            var autres = enCours.slice(1);
            autres.forEach(function (t) { t.etat = 'retrouvée'; sauverMeta(t); });
            T.derniereTrace = traces.filter(function (t) { return t.etat !== 'en cours'; }).map(resume)[0] || null;
            if (!enCours.length) return null;
            var tr = enCours[0];
            return lirePoints(tr.id).then(function (r) {
                tr.points = r.pts.length;
                if (r.pts.length) tr.fin = r.pts[r.pts.length - 1][0];
                E.trace = tr;
                E.seq = r.dernierSeq + 1;
                E.dernierT = tr.fin;
                if (r.pts.length) {
                    var q = r.pts[r.pts.length - 1];
                    E.prec = { t: q[0], lat: q[1], lon: q[2], alt: q[3], spd: q[4], crs: q[5], acc: q[6], calc: q[7] };
                }
                T.enregistrement = true;
                T.traceEnCours = resume(tr);
                traitNeuf();
                traitDepuisPoints(r.pts);
                return tr;
            });
        }).then(function (retrouvee) {
            T.etat = 'rattrapage';
            lancerSource();
            return rattraper('relancement').then(function () { return retrouvee; });
        }).then(function (retrouvee) {
            if (retrouvee) {
                var age = Date.now() - E.dernierT;
                if (E.trace && age <= (R.dureeArretMin + 5) * 60000) {
                    message('Trace du ' + frDate(retrouvee.debut) + ' (début ' + utcHM(retrouvee.debut) + ') retrouvée après un arrêt de l’app : elle continue (' + E.trace.points + ' points).');
                    log('reprise', { trace: retrouvee.id, points: E.trace.points, continuee: true });
                } else if (E.trace) {
                    var n = E.trace.points;
                    arreter('retrouvée');
                    message('Trace du ' + frDate(retrouvee.debut) + ' (début ' + utcHM(retrouvee.debut) + ') retrouvée après un arrêt brutal de l’app : ' + n + ' points enregistrés. Elle est dans la liste des traces.');
                    log('reprise', { trace: retrouvee.id, points: n, continuee: false });
                } else {
                    message('Trace du ' + frDate(retrouvee.debut) + ' retrouvée après un arrêt de l’app et terminée (atterrissage trouvé dans le journal).');
                }
            }
            T.etat = 'prêt';
            rafraichirBouton();
            rafraichirListe();
            log('pret', { enregistrement: T.enregistrement, journal: T.pointsJournal });
        }).catch(function (e) {
            T.etat = 'erreur au démarrage : ' + String(e && e.message || e).slice(0, 120);
            log('erreur-demarrage', { message: T.etat });
            /* on lance quand même la source : mieux vaut enregistrer sans reprise que rien */
            if (T.source === 'non lancée') lancerSource();
            enAttenteDeRattrapage = false;
        });
    }

    /* =========================================================== messages */
    function message(texte, dureeMs) {
        T.messages.push({ t: Date.now(), texte: texte });
        if (T.messages.length > 10) T.messages.shift();
        try {
            var box = document.getElementById('npfq400-trace-message');
            if (!box) {
                box = document.createElement('div');
                box.id = 'npfq400-trace-message';
                box.setAttribute('role', 'status');
                (document.body || document.documentElement).appendChild(box);
            }
            box.textContent = texte;
            box.style.display = 'block';
            clearTimeout(box._t);
            box._t = setTimeout(function () { box.style.display = 'none'; }, dureeMs || 9000);
            box.onclick = function () { box.style.display = 'none'; };
        } catch (_) {}
    }

    /* =========================================================== trait sur la carte */
    var trait = { morceaux: [], dernier: null, dernierT: 0, dernierCrs: null };
    var traitAffiche = null; /* trace passée affichée */
    function carte() {
        try {
            /* `map` : variable globale de la PWA (déclarée par script.js) */
            /* eslint-disable-next-line no-undef */
            return (typeof map !== 'undefined' && map && typeof map.addLayer === 'function' && window.L) ? map : null;
        } catch (_) { return null; }
    }
    function panneau(m) {
        if (!m.getPane('npfQ400TracePane')) {
            var p = m.createPane('npfQ400TracePane');
            p.style.zIndex = 395; /* sous la ligne rouge et le vecteur jaune (calque 400 et plus) */
            p.style.pointerEvents = 'none';
        }
        return 'npfQ400TracePane';
    }
    function style() {
        return { color: R.couleur, weight: R.epaisseur, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false };
    }
    function traitNeuf() {
        var m = carte();
        trait.morceaux.forEach(function (l) { try { m && m.removeLayer(l); } catch (_) {} });
        trait.morceaux = [];
        traitEnAttente = [];
        trait.dernier = null;
        trait.dernierT = 0;
        trait.dernierCrs = null;
    }
    /* Un point est dessiné s'il est à plus de 15 m du précédent ET (5 s plus tard OU virage
     * de plus de 8°) : environ 1 point toutes les 5 s en ligne droite, plus dans les virages.
     * Morceaux de 150 points au plus : un nouveau point ne redessine que le dernier morceau. */
    var traitEnAttente = [];
    var traitAttenteTimer = 0;
    function traitAjouter(p) {
        var m = carte();
        if (!m) {
            /* carte pas encore créée (démarrage) : les points seront dessinés dès qu'elle existe */
            traitEnAttente.push(p);
            if (traitEnAttente.length > 20000) traitEnAttente.shift();
            if (!traitAttenteTimer) {
                traitAttenteTimer = setInterval(function () {
                    if (!carte()) return;
                    clearInterval(traitAttenteTimer);
                    traitAttenteTimer = 0;
                    var l = traitEnAttente; traitEnAttente = [];
                    l.forEach(traitAjouter);
                }, 1000);
            }
            return;
        }
        var d = trait.dernier;
        if (d) {
            var loin = distM(d[0], d[1], p.lat, p.lon) >= 15;
            var tourne = p.crs !== null && trait.dernierCrs !== null
                && Math.abs(((p.crs - trait.dernierCrs + 540) % 360) - 180) >= 8;
            if (!loin || !(p.t - trait.dernierT >= 5000 || tourne)) return;
        }
        var ll = [p.lat, p.lon];
        var dernierMorceau = trait.morceaux[trait.morceaux.length - 1];
        if (!dernierMorceau || dernierMorceau.getLatLngs().length >= 150) {
            var depart = d ? [d, ll] : [ll];
            var opts = style();
            opts.pane = panneau(m);
            var l = window.L.polyline(depart, opts);
            l.addTo(m);
            trait.morceaux.push(l);
        } else {
            dernierMorceau.addLatLng(ll);
        }
        trait.dernier = ll;
        trait.dernierT = p.t;
        trait.dernierCrs = p.crs;
        T.traitPoints = (T.traitPoints || 0) + 1;
    }
    function traitDepuisPoints(pts) {
        pts.forEach(function (q) {
            traitAjouter({ t: q[0], lat: q[1], lon: q[2], crs: q[5] });
        });
    }
    function restylerTraits() {
        var s = style();
        trait.morceaux.forEach(function (l) { try { l.setStyle(s); } catch (_) {} });
        if (traitAffiche) traitAffiche.couches.forEach(function (l) { try { l.setStyle(s); } catch (_) {} });
    }
    function afficherTrace(traceId) {
        var m = carte();
        if (!m) return Promise.resolve(false);
        masquerTraceAffichee();
        return lirePoints(traceId).then(function (r) {
            if (!r.pts.length) { message('Cette trace ne contient aucun point.'); return false; }
            var lls = [];
            var der = null, derT = 0;
            r.pts.forEach(function (q) {
                if (!der || (distM(der[0], der[1], q[1], q[2]) >= 30 && q[0] - derT >= 4000)) {
                    der = [q[1], q[2]]; derT = q[0]; lls.push(der);
                }
            });
            var last = r.pts[r.pts.length - 1];
            lls.push([last[1], last[2]]);
            var couches = [];
            var opts = style();
            opts.pane = panneau(m);
            for (var i = 0; i < lls.length; i += 400) {
                couches.push(window.L.polyline(lls.slice(Math.max(0, i - 1), i + 400), opts).addTo(m));
            }
            traitAffiche = { id: traceId, couches: couches };
            try { m.fitBounds(window.L.latLngBounds(lls), { padding: [40, 40], maxZoom: 13 }); } catch (_) {}
            T.traceAffichee = { id: traceId, pointsDessines: lls.length };
            rafraichirListe();
            return true;
        });
    }
    function masquerTraceAffichee() {
        var m = carte();
        if (traitAffiche && m) traitAffiche.couches.forEach(function (l) { try { m.removeLayer(l); } catch (_) {} });
        traitAffiche = null;
        T.traceAffichee = null;
    }
    function cadrerTraceEnCours() {
        var m = carte();
        if (!m || !trait.morceaux.length) return false;
        var lls = [];
        trait.morceaux.forEach(function (l) { lls = lls.concat(l.getLatLngs()); });
        try { m.fitBounds(window.L.latLngBounds(lls), { padding: [60, 60], maxZoom: 12 }); } catch (_) { return false; }
        return true;
    }

    /* =========================================================== bouton TRACE */
    var APPUI_LONG_MS = 650;
    var appui = null;
    function estBoutonTrace(el) {
        return !!(el && typeof el.closest === 'function' && el.closest('#yul-trace-button'));
    }
    function rafraichirBouton() {
        var b = document.getElementById('yul-trace-button');
        if (!b) return;
        var on = !!E.trace;
        b.classList.toggle('npfq400-trace-on', on);
        b.classList.toggle('npfq400-trace-off', !on);
        b.classList.remove('npf-trace-assumed-active');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        var label = on
            ? 'TRACE — enregistrement en cours (' + E.trace.points + ' points). Appui : arrêter. Appui long : réglages.'
            : 'TRACE — arrêtée (démarrage automatique au-delà de ' + R.vitesseDemarrageKt + ' kt). Appui : démarrer. Appui long : réglages.';
        b.title = label;
        b.setAttribute('aria-label', label);
    }
    function appuiCourt() {
        if (E.trace) {
            var ok = window.confirm('Arrêter l’enregistrement de la trace ?\n\nDébut ' + utcHM(E.trace.debut) + ' · ' + E.trace.points + ' points.');
            if (ok) arreter('manuel');
        } else {
            demarrer('manuel');
            message('Trace démarrée à la main.', 4000);
        }
    }
    document.addEventListener('pointerdown', function (e) {
        if (!estBoutonTrace(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        clearTimeout(appui && appui.timer);
        appui = { long: false, timer: setTimeout(function () {
            if (!appui) return;
            appui.long = true;
            ouvrirReglages();
        }, APPUI_LONG_MS) };
    }, true);
    function finAppui(e, annule) {
        if (!appui) return;
        if (e && estBoutonTrace(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); }
        clearTimeout(appui.timer);
        var etaitLong = appui.long;
        appui = null;
        if (!annule && !etaitLong) appuiCourt();
    }
    document.addEventListener('pointerup', function (e) {
        if (!appui) return;
        finAppui(e, !estBoutonTrace(e.target));
    }, true);
    document.addEventListener('pointercancel', function (e) { finAppui(e, true); }, true);
    /* Le clic de TEST (raccourci « NPF Trace ») ne doit jamais partir dans l'app. */
    document.addEventListener('click', function (e) {
        if (!estBoutonTrace(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);
    document.addEventListener('contextmenu', function (e) {
        if (estBoutonTrace(e.target)) e.preventDefault();
    }, true);

    /* =========================================================== styles */
    function poserStyles() {
        if (document.getElementById('npfq400-trace-style')) return;
        var s = document.createElement('style');
        s.id = 'npfq400-trace-style';
        s.textContent = [
            /* bouton : gris = arrêté, rouge = enregistrement */
            'html.npf-q400-app #yul-trace-button.npfq400-trace-off{border-color:rgba(75,85,99,.55)!important;background:rgba(255,255,255,.96)!important;}',
            'html.npf-q400-app #yul-trace-button.npfq400-trace-off .npf-trace-record-icon{border-color:#6b7280!important;background:transparent!important;box-shadow:none!important;}',
            'html.npf-q400-app #yul-trace-button.npfq400-trace-on{border-color:#b91c1c!important;background:#fee2e2!important;}',
            'html.npf-q400-app #yul-trace-button.npfq400-trace-on .npf-trace-record-icon{border-color:#dc2626!important;background:#dc2626!important;box-shadow:0 0 0 4px rgba(220,38,38,.18)!important;animation:npfq400-trace-pulse 1.6s ease-in-out infinite;}',
            '@keyframes npfq400-trace-pulse{0%,100%{opacity:1}50%{opacity:.55}}',
            'html.npf-q400-app #yul-trace-button{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;}',
            /* message */
            '#npfq400-trace-message{display:none;position:fixed;left:50%;top:calc(var(--npf-barre-haut,0px) + 70px);transform:translateX(-50%);z-index:2147483600;max-width:min(560px,calc(100vw - 32px));padding:12px 16px;border-radius:12px;background:#0b1220;color:#fff;font:600 15px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);}',
            /* fenêtre Réglages Trace */
            '#npfq400-trace-reglages{position:fixed;inset:0;z-index:2147483500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);padding:16px;box-sizing:border-box;}',
            '#npfq400-trace-reglages .npfq400-boite{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#111827;border-radius:16px;padding:18px 20px;box-sizing:border-box;font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.35);}',
            '#npfq400-trace-reglages h3{margin:0 0 12px;font-size:19px;color:#0b2f6b;}',
            '#npfq400-trace-reglages .npfq400-ligne{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:9px 0;}',
            '#npfq400-trace-reglages .npfq400-ligne label{flex:1;}',
            '#npfq400-trace-reglages input[type=number]{width:96px;font-size:17px;padding:7px 8px;border:1px solid #9ca3af;border-radius:8px;text-align:right;}',
            '#npfq400-trace-reglages .npfq400-palette{display:flex;flex-wrap:wrap;gap:8px;}',
            '#npfq400-trace-reglages .npfq400-couleur{width:34px;height:34px;border-radius:50%;border:2px solid #d1d5db;padding:0;cursor:pointer;}',
            '#npfq400-trace-reglages .npfq400-couleur.npfq400-choisie{outline:3px solid #0b5ed7;outline-offset:2px;}',
            '#npfq400-trace-reglages .npfq400-apercu{height:24px;display:flex;align-items:center;}',
            '#npfq400-trace-reglages .npfq400-boutons{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:16px;}',
            '#npfq400-trace-reglages button.npfq400-b{min-height:42px;padding:8px 14px;border-radius:10px;border:1px solid #9ca3af;background:#f3f4f6;font:600 15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;}',
            '#npfq400-trace-reglages button.npfq400-b.npfq400-principal{background:#0b5ed7;border-color:#0b5ed7;color:#fff;}',
            '#npfq400-trace-reglages .npfq400-etat{margin:10px 0 0;padding:8px 10px;border-radius:8px;background:#f3f4f6;font-size:13px;color:#374151;}',
            /* liste des traces (Gestion des Cartes) */
            '#npfq400-traces-section .npfq400-trace-item{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.08);}',
            '#npfq400-traces-section .npfq400-trace-info{flex:1 1 220px;}',
            '#npfq400-traces-section .npfq400-trace-actions{display:flex;gap:6px;flex-wrap:wrap;}',
            '#npfq400-traces-section .npfq400-trace-actions button{min-height:38px;}',
            '#npfq400-traces-section .npfq400-en-cours{color:#b91c1c;font-weight:700;}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(s);
    }

    /* =========================================================== fenêtre Réglages Trace */
    function ouvrirReglages() {
        poserStyles();
        fermerReglages();
        var r = JSON.parse(JSON.stringify(R));
        var w = document.createElement('div');
        w.id = 'npfq400-trace-reglages';
        w.setAttribute('role', 'dialog');
        w.setAttribute('aria-modal', 'true');
        w.setAttribute('aria-labelledby', 'npfq400-trace-reglages-titre');
        function champ(id, label, val, step, min, max) {
            return '<div class="npfq400-ligne"><label for="' + id + '">' + label + '</label>'
                + '<input type="number" inputmode="decimal" id="' + id + '" value="' + val + '" step="' + step + '" min="' + min + '" max="' + max + '"></div>';
        }
        var etat = E.trace
            ? 'Enregistrement en cours depuis ' + utcHM(E.trace.debut) + ' · ' + E.trace.points + ' points · ' + E.trace.trous.length + ' trou(s) > 30 s'
            : 'Arrêté · démarrage automatique au-delà de la vitesse de démarrage · source GPS : ' + T.source;
        w.innerHTML = '<div class="npfq400-boite">'
            + '<h3 id="npfq400-trace-reglages-titre">Réglages Trace</h3>'
            + champ('npfq400-r-vd', 'Vitesse de démarrage (kt)', r.vitesseDemarrageKt, 1, 10, 250)
            + champ('npfq400-r-dd', 'Durée avant démarrage (s)', r.dureeDemarrageS, 1, 0, 600)
            + champ('npfq400-r-va', 'Vitesse d’arrêt (kt)', r.vitesseArretKt, 1, 5, 200)
            + champ('npfq400-r-da', 'Durée avant arrêt (min)', r.dureeArretMin, 0.5, 0.5, 30)
            + champ('npfq400-r-ma', 'Minutes d’avant gardées', r.minutesAvant, 0.5, 0, 10)
            + '<div class="npfq400-ligne"><span>Couleur du trait</span><div class="npfq400-palette">'
            + PALETTE.map(function (p) {
                return '<button type="button" class="npfq400-couleur" data-c="' + p.c + '" title="' + p.n + '" aria-label="' + p.n + '" style="background:' + p.c + '"></button>';
            }).join('') + '</div></div>'
            + champ('npfq400-r-ep', 'Épaisseur du trait (px)', r.epaisseur, 1, 1, 12)
            + '<div class="npfq400-ligne"><span>Aperçu</span><div class="npfq400-apercu"><svg width="160" height="24" aria-hidden="true"><line id="npfq400-r-apercu" x1="8" y1="12" x2="152" y2="12" stroke-linecap="round"></line></svg></div></div>'
            + '<div class="npfq400-etat" id="npfq400-r-etat">' + esc(etat) + '</div>'
            + '<div class="npfq400-boutons">'
            + '<button type="button" class="npfq400-b" id="npfq400-r-defaut">Valeurs par défaut</button>'
            + '<button type="button" class="npfq400-b" id="npfq400-r-fermer">Annuler</button>'
            + '<button type="button" class="npfq400-b npfq400-principal" id="npfq400-r-ok">Enregistrer</button>'
            + '</div></div>';
        (document.body || document.documentElement).appendChild(w);
        var choix = r.couleur;
        function maj() {
            var ep = Number(document.getElementById('npfq400-r-ep').value) || r.epaisseur;
            var ln = document.getElementById('npfq400-r-apercu');
            ln.setAttribute('stroke', choix);
            ln.setAttribute('stroke-width', String(Math.min(12, Math.max(1, ep))));
            Array.prototype.forEach.call(w.querySelectorAll('.npfq400-couleur'), function (b) {
                b.classList.toggle('npfq400-choisie', b.getAttribute('data-c') === choix);
            });
        }
        function remplir(v) {
            document.getElementById('npfq400-r-vd').value = v.vitesseDemarrageKt;
            document.getElementById('npfq400-r-dd').value = v.dureeDemarrageS;
            document.getElementById('npfq400-r-va').value = v.vitesseArretKt;
            document.getElementById('npfq400-r-da').value = v.dureeArretMin;
            document.getElementById('npfq400-r-ma').value = v.minutesAvant;
            document.getElementById('npfq400-r-ep').value = v.epaisseur;
            choix = v.couleur;
            maj();
        }
        Array.prototype.forEach.call(w.querySelectorAll('.npfq400-couleur'), function (b) {
            b.addEventListener('click', function () { choix = b.getAttribute('data-c'); maj(); });
        });
        document.getElementById('npfq400-r-ep').addEventListener('input', maj);
        document.getElementById('npfq400-r-defaut').addEventListener('click', function () { remplir(DEFAUTS); });
        document.getElementById('npfq400-r-fermer').addEventListener('click', fermerReglages);
        document.getElementById('npfq400-r-ok').addEventListener('click', function () {
            ecrireReglages({
                vitesseDemarrageKt: document.getElementById('npfq400-r-vd').value,
                dureeDemarrageS: document.getElementById('npfq400-r-dd').value,
                vitesseArretKt: document.getElementById('npfq400-r-va').value,
                dureeArretMin: document.getElementById('npfq400-r-da').value,
                minutesAvant: document.getElementById('npfq400-r-ma').value,
                couleur: choix,
                epaisseur: document.getElementById('npfq400-r-ep').value
            });
            fermerReglages();
            rafraichirBouton();
            message('Réglages Trace enregistrés.', 3000);
        });
        w.addEventListener('click', function (e) { if (e.target === w) fermerReglages(); });
        maj();
        T.reglagesOuverts = true;
    }
    function fermerReglages() {
        var w = document.getElementById('npfq400-trace-reglages');
        if (w) w.remove();
        T.reglagesOuverts = false;
    }

    /* =========================================================== liste des traces */
    function poserSectionListe() {
        if (document.getElementById('npfq400-traces-section')) return true;
        var contenu = document.querySelector('#offline-map-modal .modal-content');
        if (!contenu) return false;
        var s = document.createElement('div');
        s.id = 'npfq400-traces-section';
        s.className = 'vac-management-section npfq400-traces-section';
        s.innerHTML = '<h3 class="maps-management-title">Traces de vol (NPF-Q400 APP)</h3>'
            + '<p>Enregistrement automatique (démarrage, arrêt et réglages : appui long sur le bouton TRACE). Heures en UTC.</p>'
            + '<div class="npfq400-trace-actions" style="margin:6px 0 4px">'
            + '<button type="button" class="import-button" id="npfq400-traces-reglages">Réglages Trace</button>'
            + '<button type="button" class="import-button" id="npfq400-traces-masquer" style="display:none">Masquer la trace affichée</button>'
            + '</div>'
            + '<ul id="npfq400-traces-liste" style="list-style:none;padding:0;margin:0"><li>Chargement…</li></ul>';
        contenu.appendChild(s);
        document.getElementById('npfq400-traces-reglages').addEventListener('click', ouvrirReglages);
        document.getElementById('npfq400-traces-masquer').addEventListener('click', function () {
            masquerTraceAffichee();
            rafraichirListe();
        });
        document.getElementById('npfq400-traces-liste').addEventListener('click', function (e) {
            var b = e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
            if (!b) return;
            var id = Number(b.getAttribute('data-id'));
            var a = b.getAttribute('data-action');
            if (a === 'afficher') {
                afficherTrace(id).then(function (ok) {
                    if (!ok) return;
                    var modal = document.getElementById('offline-map-modal');
                    var fermer = document.getElementById('close-offline-map-btn');
                    if (fermer) fermer.click(); else if (modal) modal.style.display = 'none';
                });
            } else if (a === 'exporter') {
                exporterGpx(id);
            } else if (a === 'supprimer') {
                if (E.trace && E.trace.id === id) { window.alert('La trace en cours ne peut pas être supprimée.'); return; }
                if (window.confirm('Supprimer définitivement cette trace de l’iPad ?')) {
                    if (traitAffiche && traitAffiche.id === id) masquerTraceAffichee();
                    supprimerTrace(id).then(rafraichirListe, rafraichirListe);
                }
            }
        });
        return true;
    }
    var listeTimer = 0;
    function rafraichirListe() {
        clearTimeout(listeTimer);
        listeTimer = setTimeout(function () {
            var ul = document.getElementById('npfq400-traces-liste');
            if (!ul) return;
            var masquer = document.getElementById('npfq400-traces-masquer');
            if (masquer) masquer.style.display = traitAffiche ? '' : 'none';
            lireTraces().then(function (traces) {
                T.nombreTraces = traces.length;
                if (!traces.length) { ul.innerHTML = '<li>Aucune trace enregistrée.</li>'; return; }
                ul.innerHTML = traces.map(function (t) {
                    var enCours = E.trace && E.trace.id === t.id;
                    var pts = enCours ? E.trace.points : t.points;
                    var fin = enCours ? E.trace.fin : t.fin;
                    var nbTrous = (enCours ? E.trace.trous : t.trous || []).length;
                    var info = frDate(t.debut) + ' · ' + utcHM(t.debut) + ' · ' + duree(fin - t.debut)
                        + ' · ' + pts + ' points'
                        + (nbTrous ? ' · ' + nbTrous + ' trou(s) > 30 s' : '')
                        + (t.etat === 'retrouvée' ? ' · retrouvée après un arrêt de l’app' : '')
                        + (t.mode === 'manuel' ? ' · démarrée à la main' : '');
                    return '<li class="npfq400-trace-item" data-id="' + t.id + '">'
                        + '<span class="npfq400-trace-info">' + (enCours ? '<span class="npfq400-en-cours">● en cours</span> ' : '') + esc(info) + '</span>'
                        + '<span class="npfq400-trace-actions">'
                        + '<button type="button" class="import-button" data-action="afficher" data-id="' + t.id + '">' + (traitAffiche && traitAffiche.id === t.id ? 'Affichée' : 'Afficher') + '</button>'
                        + '<button type="button" class="import-button" data-action="exporter" data-id="' + t.id + '">Exporter (GPX)</button>'
                        + (enCours ? '' : '<button type="button" class="danger-inline-btn" data-action="supprimer" data-id="' + t.id + '">Supprimer</button>')
                        + '</span></li>';
                }).join('');
            }).catch(function (e) {
                ul.innerHTML = '<li>Liste indisponible : ' + esc(String(e && e.message || e)) + '</li>';
            });
        }, 150);
    }

    /* =========================================================== GPX */
    function nomGpx(t) {
        var d = new Date(t);
        return 'NPF-Q400_trace_' + utcDate(t) + '_' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + 'Z.gpx';
    }
    function iso(t) { return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
    function construireGpx(meta, pts) {
        var nom = 'NPF-Q400 trace ' + utcDate(meta.debut) + ' ' + utcHM(meta.debut);
        var out = [];
        out.push('<?xml version="1.0" encoding="UTF-8"?>');
        out.push('<gpx version="1.1" creator="NPF-Q400 APP ' + VERSION + '" xmlns="http://www.topografix.com/GPX/1/1"'
            + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
            + ' xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"'
            + ' xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd'
            + ' http://www.garmin.com/xmlschemas/TrackPointExtension/v2 http://www8.garmin.com/xmlschemas/TrackPointExtensionv2.xsd">');
        out.push('  <metadata><name>' + esc(nom) + '</name><time>' + iso(meta.debut) + '</time></metadata>');
        out.push('  <trk>');
        out.push('    <name>' + esc(nom) + '</name>');
        out.push('    <desc>' + esc((meta.mode === 'manuel' ? 'Démarrée à la main' : 'Démarrage automatique') + ' · ' + pts.length + ' points · '
            + ((meta.trous || []).length) + ' trou(s) de plus de 30 s') + '</desc>');
        out.push('    <trkseg>');
        var prec = null;
        pts.forEach(function (q) {
            if (prec && q[0] - prec[0] > 30000) { out.push('    </trkseg>'); out.push('    <trkseg>'); }
            var s = '      <trkpt lat="' + q[1].toFixed(7) + '" lon="' + q[2].toFixed(7) + '">';
            if (q[3] !== null && q[3] !== undefined) s += '<ele>' + Number(q[3]).toFixed(1) + '</ele>';
            s += '<time>' + iso(q[0]) + '</time>';
            if ((q[4] !== null && q[4] !== undefined) || (q[5] !== null && q[5] !== undefined)) {
                s += '<extensions><gpxtpx:TrackPointExtension>';
                if (q[4] !== null && q[4] !== undefined) s += '<gpxtpx:speed>' + Number(q[4]).toFixed(2) + '</gpxtpx:speed>';
                if (q[5] !== null && q[5] !== undefined) s += '<gpxtpx:course>' + Number(q[5]).toFixed(1) + '</gpxtpx:course>';
                s += '</gpxtpx:TrackPointExtension></extensions>';
            }
            s += '</trkpt>';
            out.push(s);
            prec = q;
        });
        out.push('    </trkseg>');
        out.push('  </trk>');
        out.push('</gpx>');
        return out.join('\n') + '\n';
    }
    function gpxDeLaTrace(traceId) {
        var d = (E.trace && E.trace.id === traceId) ? sauver(true) : Promise.resolve();
        return d.then(function () {
            return Promise.all([
                tx(['traces'], 'readonly', function (t) { return t.objectStore('traces').get(traceId); }),
                lirePoints(traceId)
            ]);
        }).then(function (r) {
            var meta = r[0];
            if (!meta) throw new Error('trace introuvable');
            return { nom: nomGpx(meta.debut), texte: construireGpx(meta, r[1].pts), points: r[1].pts.length };
        });
    }
    function exporterGpx(traceId) {
        return gpxDeLaTrace(traceId).then(function (g) {
            T.dernierGpx = { nom: g.nom, points: g.points, taille: g.texte.length };
            if (SIM) T.dernierGpxTexte = g.texte;
            log('gpx', T.dernierGpx);
            return partagerFichier(g.nom, g.texte, 'Trace de vol NPF-Q400');
        }).catch(function (e) {
            if (e && /cancel|annul/i.test(String(e.message || e))) return;
            window.alert('Export GPX impossible : ' + String(e && e.message || e));
        });
    }

    /* =========================================================== partage iPad */
    function partagerFichier(nom, texte, titre) {
        T.partages.push({ t: Date.now(), nom: nom, taille: texte.length });
        if (T.partages.length > 10) T.partages.shift();
        if (!NATIVE) {
            if (SIM) { T.partageSimule = { nom: nom, texte: texte, titre: titre }; log('partage-simule', { nom: nom }); }
            return Promise.resolve(false);
        }
        var chemin = 'npfq400-partage/' + nom;
        return cap.nativePromise('Filesystem', 'writeFile', {
            path: chemin, data: texte, directory: 'CACHE', encoding: 'utf8', recursive: true
        }).then(function (res) {
            return cap.nativePromise('Share', 'share', { title: titre || nom, files: [res.uri] });
        }).then(function () {
            log('partage', { nom: nom });
            return true;
        }, function (e) {
            var msg = String(e && (e.message || e.code) || e);
            if (/cancel/i.test(msg)) return false; /* fenêtre fermée sans choix */
            throw e;
        });
    }

    /* DIAG, KML et CSV feu de la PWA : dans l'app, par la fenêtre de partage iPad. */
    (function partagesPwa() {
        var natifShare = navigator.share ? navigator.share.bind(navigator) : null;
        var natifCanShare = navigator.canShare ? navigator.canShare.bind(navigator) : null;
        function estDiag(data) {
            return !!(data && data.files && data.files.length && Array.prototype.some.call(data.files, function (f) {
                return f && /^NPF_DIAG_.*\.txt$/i.test(String(f.name || ''));
            }));
        }
        try {
            Object.defineProperty(navigator, 'share', {
                configurable: true,
                value: function (data) {
                    if (estDiag(data)) {
                        var f = Array.prototype.find.call(data.files, function (x) { return /^NPF_DIAG_/i.test(String(x.name || '')); });
                        return f.text().then(function (txt) {
                            return partagerFichier(f.name, txt, data.title || 'Diagnostic NPF-Q400');
                        }).then(function () { return undefined; }, function (e) {
                            var err = new Error(String(e && e.message || e));
                            err.name = 'AbortError';
                            throw err;
                        });
                    }
                    if (natifShare) return natifShare(data);
                    return Promise.reject(Object.assign(new Error('Partage indisponible'), { name: 'NotAllowedError' }));
                }
            });
            Object.defineProperty(navigator, 'canShare', {
                configurable: true,
                value: function (data) {
                    if (estDiag(data)) return true;
                    return natifCanShare ? natifCanShare(data) : false;
                }
            });
        } catch (_) {}
        var clicNatif = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
            var nom = String(this.download || '');
            var href = String(this.href || '');
            if (nom && /\.(kml|csv|txt)$/i.test(nom) && /^(blob:|data:)/i.test(href)) {
                var self = this;
                fetch(href).then(function (r) { return r.text(); }).then(function (txt) {
                    return partagerFichier(nom, txt, nom);
                }).catch(function (e) {
                    window.alert('Partage impossible : ' + String(e && e.message || e));
                });
                return undefined;
            }
            return clicNatif.apply(this, arguments);
        };
    })();

    /* =========================================================== DIAG */
    function lignesDiag() {
        var l = [];
        l.push('################ NPF-Q400 APP — TRACE ################');
        l.push('Trace : ' + (E.trace ? 'enregistrement en cours (' + (E.trace.mode === 'manuel' ? 'démarrée à la main' : 'automatique') + ')' : 'arrêtée (armée : ' + (E.autoPermis ? 'oui' : 'non, attente de l’atterrissage') + ')')
            + ' | état ' + T.etat + ' | source GPS ' + T.source + (T.sourceErreur ? ' (' + T.sourceErreur + ')' : ''));
        l.push('Trace : points reçus ' + T.pointsRecus + ' (dont repris du journal natif ' + T.pointsJournal + ') | ignorés (doublons) ' + T.pointsIgnores);
        if (T.dernierPointRecu) l.push('Trace : dernier point reçu ' + utcHMS(T.dernierPointRecu.t) + ' (il y a ' + Math.round((Date.now() - T.dernierPointRecu.t) / 1000) + ' s) · ' + (T.dernierPointRecu.kt === null ? 'vitesse inconnue' : T.dernierPointRecu.kt + ' kt'));
        if (E.trace) {
            l.push('Trace en cours : début ' + frDate(E.trace.debut) + ' ' + utcHMS(E.trace.debut) + ' | ' + E.trace.points + ' points | dernier point enregistré ' + utcHMS(E.trace.fin)
                + ' | trous > 30 s : ' + E.trace.trous.length + (E.trace.trous.length ? ' (' + E.trace.trous.map(function (g) { return utcHMS(g[0]) + '→' + utcHMS(g[1]); }).join(', ') + ')' : ''));
        }
        if (T.derniereSauvegarde) l.push('Trace : dernier lot enregistré ' + new Date(T.derniereSauvegarde.t).toLocaleTimeString('fr-FR') + ' (' + T.derniereSauvegarde.points + ' points)' + (T.erreurSauvegarde ? ' | ERREUR ' + T.erreurSauvegarde : ''));
        if (T.derniereTrace) l.push('Dernière trace : ' + frDate(T.derniereTrace.debut) + ' ' + utcHM(T.derniereTrace.debut) + ' → ' + utcHM(T.derniereTrace.fin) + ' | ' + T.derniereTrace.points + ' points | ' + T.derniereTrace.trous + ' trou(s) > 30 s | ' + T.derniereTrace.etat);
        l.push('Réglages Trace : démarrage ' + R.vitesseDemarrageKt + ' kt pendant ' + R.dureeDemarrageS + ' s | arrêt ' + R.vitesseArretKt + ' kt pendant ' + R.dureeArretMin + ' min | ' + R.minutesAvant + ' min d’avant | trait ' + R.couleur + ' ' + R.epaisseur + ' px');
        l.push('Traces stockées : ' + (T.nombreTraces === undefined ? '—' : T.nombreTraces) + (T.dernierRattrapage ? ' | dernière reprise du journal : ' + T.dernierRattrapage.points + ' points (' + T.dernierRattrapage.raison + ')' : ''));
        return l;
    }
    T.lignesDiag = lignesDiag;
    function brancherDiag() {
        var orig = window.buildNpfStartupDiagnosticExportText;
        if (typeof orig !== 'function' || orig.__npfQ400Trace) return;
        var f = function () {
            var texte = orig.apply(this, arguments);
            var ajout = lignesDiag().join('\n') + '\n\n';
            var fin = '################ FIN ################';
            return texte.indexOf(fin) >= 0 ? texte.replace(fin, ajout + fin) : texte + '\n' + ajout;
        };
        f.__npfQ400Trace = true;
        window.buildNpfStartupDiagnosticExportText = f;
    }

    /* =========================================================== essais (Debug / PC seulement) */
    /* Fabrication Debug (simulateur) : la recette d'essai pose des ordres dans
     * Documents/npfq400-essai.json (seq, action). Jamais dans l'app livrée. */
    function executerOrdre(o) {
        var a = o && o.action;
        log('ordre', { action: a, seq: o && o.seq });
        if (a === 'reglages') { ouvrirReglages(); return Promise.resolve(true); }
        if (a === 'fermer') {
            fermerReglages();
            var cl = document.getElementById('close-offline-map-btn');
            var modal = document.getElementById('offline-map-modal');
            if (modal && modal.style.display !== 'none' && cl) cl.click();
            return Promise.resolve(true);
        }
        if (a === 'liste') {
            var b = document.getElementById('offline-maps-button');
            var md = document.getElementById('offline-map-modal');
            if (md && md.style.display === 'none' && b) b.click();
            if (md && md.style.display === 'none') md.style.display = 'block';
            poserSectionListe();
            rafraichirListe();
            setTimeout(function () {
                var s = document.getElementById('npfq400-traces-section');
                if (s && s.scrollIntoView) s.scrollIntoView({ block: 'start' });
            }, 400);
            return Promise.resolve(true);
        }
        if (a === 'cadrer') return Promise.resolve(cadrerTraceEnCours() || (T.derniereTrace ? afficherTrace(T.derniereTrace.id) : false));
        if (a === 'afficher-derniere') return T.derniereTrace ? afficherTrace(T.derniereTrace.id) : Promise.resolve(false);
        if (a === 'gpx' || a === 'exporter') {
            return lireTraces().then(function (l) {
                var t = l.filter(function (x) { return x.etat !== 'en cours'; })[0] || l[0];
                if (!t) return false;
                if (a === 'exporter') return exporterGpx(t.id);
                return gpxDeLaTrace(t.id).then(function (g) {
                    return cap.nativePromise('Filesystem', 'writeFile', {
                        path: 'npfq400-gpx/' + g.nom, data: g.texte, directory: 'DOCUMENTS', encoding: 'utf8', recursive: true
                    }).then(function () {
                        log('gpx-ecrit', { nom: g.nom, points: g.points, taille: g.texte.length });
                        return true;
                    });
                });
            });
        }
        if (a === 'non-vac') {
            /* fenêtre « Télécharger cartes VAC » de la PWA au premier lancement : « Non » */
            var non = document.getElementById('vac-update-later-button');
            if (non && non.offsetParent !== null) { non.click(); return Promise.resolve(true); }
            return Promise.resolve(false);
        }
        if (a === 'demarrer') { demarrer('manuel'); return Promise.resolve(true); }
        if (a === 'diag') { log('diag', { lignes: lignesDiag() }); return Promise.resolve(true); }
        return Promise.resolve(false);
    }
    if (DEBUG && NATIVE) {
        var dernierOrdre = 0;
        setInterval(function () {
            cap.nativePromise('Filesystem', 'readFile', { path: 'npfq400-essai.json', directory: 'DOCUMENTS', encoding: 'utf8' })
                .then(function (r) {
                    var o = JSON.parse(String(r && r.data || '{}'));
                    if (!o || !(Number(o.seq) > dernierOrdre)) return;
                    dernierOrdre = Number(o.seq);
                    return executerOrdre(o);
                }).catch(function () {});
        }, 2000);
    }

    /* Essais PC (?npfq400app-sim=1 sur localhost) : injection de positions datées, sans attendre. */
    if (SIM) {
        T.test = {
            injecter: function (liste) { liste.forEach(function (d) { recevoirDirect(d); }); },
            moteur: E,
            sauver: function () { return sauver(true); },
            lireTraces: lireTraces,
            lirePoints: lirePoints,
            gpx: gpxDeLaTrace,
            exporter: exporterGpx,
            afficher: afficherTrace,
            masquer: masquerTraceAffichee,
            ordre: executerOrdre,
            traitMorceaux: function () { return trait.morceaux.map(function (l) { return { n: l.getLatLngs().length, color: l.options.color, weight: l.options.weight, pane: l.options.pane }; }); },
            /* relancement simulé : nouvelle lecture d'IndexedDB comme après un arrêt brutal */
            verifierArret: function () { verifierArretHorloge(); return T.enregistrement; },
            ajouterLotBrut: function (traceId, seq, pts) { return ajouterLot(traceId, seq, pts); },
            echecFicheUneFois: false,
            relancer: function () {
                E.trace = null; E.tampon = []; E.dernierT = 0; E.prec = null; E.attente = [];
                E.auDessusDepuis = null; E.enDessousDepuis = null; E.autoPermis = true;
                T.enregistrement = false; T.traceEnCours = null;
                traitNeuf();
                return demarrage();
            },
            /* arrêt brutal simulé : la page « meurt » sans sauvegarder ce qui est en attente */
            arretBrutal: function () { var perdus = E.attente.length; E.attente = []; return perdus; }
        };
    }

    /* =========================================================== mise en route */
    function quandPret() {
        poserStyles();
        rafraichirBouton();
        setTimeout(rafraichirBouton, 1500); /* après l'initialisation du bouton par TEST */
        brancherDiag();
        poserSectionListe();
        var modal = document.getElementById('offline-map-modal');
        if (modal && typeof MutationObserver === 'function') {
            new MutationObserver(function () {
                if (modal.style.display !== 'none') { poserSectionListe(); rafraichirListe(); }
            }).observe(modal, { attributes: true, attributeFilter: ['style'] });
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', quandPret, { once: true });
    } else {
        quandPret();
    }
    demarrage();
})();
