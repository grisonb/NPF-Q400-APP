# NPF-Q400 APP — journal cumulatif

Nouvelle entrée en tête. Rien n'est jamais effacé (essais ratés et abandons compris).
Statuts : `NON IMPLÉMENTÉ`, `À MESURER`, `À DÉCIDER`, `ABANDONNÉ`, `À REVOIR`, `VALIDÉ`, `non vérifié`.

---

## 17/11/2026 — v0.5.1 : arrêt automatique à l'horloge, recette simulateur corrigée

### Runs de la 0.5 (`ac4fccc`)
- 1re tentative : fabrication ET essai simulateur **non démarrés** : GitHub n'a trouvé aucun Mac
  arm64 libre en 15 min (même message qu'au 16/11). Relancés sans changement de code.
- 2e tentative : fabrication sans signature **verte** (run 44136435934) ; essai simulateur de
  nouveau sans Mac → relancé. 3e tentative : essai simulateur **vert** (run 44136436010,
  18:01 → 18:30 UTC), iPad (9th generation), iOS 26.5.
- Résultats (paysage / portrait) :
  - démarrage automatique en vol, avec les minutes d'avant (72 / 136 points) ;
  - **arrière-plan** (Réglages d'iOS devant l'app) : 56 points en 56 s / 39 points en 38 s dans
    le GPX, plus grand écart 2 s. Au retour, 107 / 7 points repris du journal natif : la page
    était endormie, le journal a tout gardé. **VALIDÉ (simulateur)** ;
  - GPX écrit, XML valide (`xmllint`), 312 / 319 points, vitesse présente, altitude absente
    (le simulateur ne donne pas d'altitude valide ; Safari la laisserait vide aussi) ;
  - fenêtre de partage iPad ouverte avec `NPF-Q400_trace_….gpx` (77 Ko), « Copier »,
    « Enregistrer dans Fichiers » ; fenêtre Réglages Trace et liste affichées ; bouton rouge ;
  - **défaut 1 : pas d'arrêt automatique.** Position fixe à l'arrêt → iOS n'envoie plus aucun
    point → le moteur, qui ne décidait qu'à l'arrivée d'un point, n'a jamais conclu. La liste
    montre la trace toujours « en cours » ;
  - **défaut 2 (essai)** : la fenêtre « Télécharger cartes VAC » de la PWA (1er lancement)
    floute toutes les captures ; le trait n'est pas lisible ;
  - **défaut 3 (essai)** : « erreurs » `readFile … npfq400-essai.json does not exist` dans la
    console : le fichier d'ordres d'essai n'existait pas encore (sans effet sur l'app) ;
  - portrait : l'app s'est fermée normalement (« exit handler », aucun plantage dans le journal
    système) environ 8 s après l'ouverture de la fenêtre de partage, en fin d'essai. Cause
    **non vérifiée** (paysage : pas de fermeture) ;
  - portrait : une erreur ponctuelle du GPS de la carte au démarrage (« There was an error trying
    to obtain the location. », `OS-PLUG-GLOC-0002`) pendant le changement de position simulée ;
    la PWA l'a traitée normalement.

### Corrections (0.5.1, build 6)
- Arrêt automatique vérifié aussi **à l'horloge** toutes les 5 s : atterrissage commencé (vitesse
  sous la vitesse d'arrêt), aucun point depuis 10 s, journal natif déjà repris, durée d'arrêt
  écoulée → arrêt. Même chose pour le réarmement après un arrêt à la main. En vol, sans points
  (GPS perdu à grande vitesse), rien ne s'arrête.
- Essai PC ajouté : vol dont les derniers points lents datent de 150 s → arrêt à l'horloge.
  **52 contrôles sur 52 OK.**
- Recette simulateur : fichier d'ordres créé avant le lancement ; ordre « non-vac » (répond
  « Non » à « Télécharger cartes VAC », fabrication Debug seulement) à t+27 s et au retour au
  premier plan.
- `patch-package` remplacé par `scripts/patch-plugins.mjs` (même correctif « avion », aucune
  dépendance) : `npm audit` signalait 4 alertes « élevées » dans `picomatch`, dépendance de
  `patch-package` (outil d'installation seulement, jamais dans l'app), sans version corrigée
  compatible. Maintenant : 0 alerte.
- Version 0.5.1 (correction de la 0.5) : tous les numéros changés ensemble.

---

## 17/11/2026 — v0.5 : enregistrement automatique de la trace de vol

Base inchangée : NPF-Q400 TEST v17.97 (`web-test/` identique). Version 0.5 (build 5), tous les
numéros changés ensemble.

### Natif
- Plugins : `@capgo/background-geolocation` 8.6.4 (trace, arrière-plan), `@capacitor/share` 8.0.3,
  `@capacitor/filesystem` 8.1.5 (fichiers à partager). `Info.plist` : texte « Toujours »
  (`NSLocationAlwaysAndWhenInUseUsageDescription`, en français), mode arrière-plan `location`.
- **Type d'activité « avion »** : le plugin ne permet pas de le régler → correctif d'une ligne
  (`patches/@capgo+background-geolocation+8.6.4.patch`, option `activityType: 'airborne'`),
  appliqué automatiquement à chaque `npm ci` par `patch-package` (script `postinstall`) — remplacé en 0.5.1 par `scripts/patch-plugins.mjs`.
  Pause automatique d'iOS : déjà désactivée par le plugin. Précision : la meilleure d'iOS
  (« navigation » si l'iPad est branché).

### Architecture (décision)
- **Deux flux GPS séparés** : la carte garde exactement le GPS de la 0.4 (`@capacitor/geolocation`,
  cap = route, ≈ 1 position/s, contrôles 0.4 inchangés et verts) ; la trace utilise le plugin
  d'arrière-plan, lancé dès l'ouverture de l'app (il doit tourner avant le décollage pour
  démarrer seul à 50 kt, même écran verrouillé). Un seul flux aurait obligé à changer le GPS
  de la carte.
- Chaque position de la trace est aussi écrite par iOS dans le **journal natif** du plugin
  (fichier). Au retour au premier plan, toutes les 30 s et au relancement, les points absents
  de la page y sont repris dans l'ordre, puis le journal est vidé jusqu'au dernier point lu.
  Rien n'est perdu si iOS endort ou ferme la page en arrière-plan.
- Fichier séparé `app-layer/npf-q400-app-trace.js`, chargé juste après la couche app, inactif
  hors de l'app.

### Démarrage / arrêt automatiques (réglages par défaut, tous modifiables)
- Démarrage : vitesse ≥ 50 kt pendant 30 s. La trace commence 2 min AVANT le moment où la
  vitesse a dépassé 50 kt (mémoire tampon tournante ; décision : avant le début de la course
  au décollage plutôt qu'avant l'instant de détection).
- Arrêt : vitesse < 30 kt pendant 2 min (la trace garde ces 2 min). Une remise de gaz ou un
  écopage restent au-dessus de 30 kt : pas d'arrêt. Une escale (posé > 2 min) : arrêt, nouvelle
  trace au décollage suivant.
- Vitesse calculée à partir des positions si le GPS ne la donne pas.
- Décisions prises seul :
  - démarrage à la main : la trace commence à l'appui (sans minutes d'avant) ; l'arrêt
    automatique ne s'applique qu'après un passage au-dessus de la vitesse de démarrage (une
    trace lancée au sol ne s'arrête pas toute seule au roulage) ;
  - arrêt à la main en vol : pas de redémarrage automatique avant un atterrissage (vitesse
    < 30 kt pendant 2 min), sinon la trace repartirait 30 s plus tard ;
  - trace démarrée puis arrêtée sans aucun point : supprimée (pas de ligne vide) ;
  - bouton « Supprimer » (avec confirmation) dans la liste des traces, non demandé, pour que
    l'iPad ne se remplisse pas (≈ 1 Mo par heure de vol).

### Interface (dans l'app seulement)
- Bouton TRACE : n'ouvre plus Raccourcis. Gris = arrêté, rouge (clignotement doux) =
  enregistrement. Appui court : démarrer, ou arrêter après confirmation. Appui long (0,65 s) :
  « Réglages Trace ».
- « Réglages Trace » : vitesse de démarrage (kt), durée avant démarrage (s), vitesse d'arrêt (kt),
  durée avant arrêt (min), minutes d'avant gardées, couleur du trait (7 couleurs, défaut bleu
  foncé ; ni rouge ni jaune), épaisseur (défaut 4 px), aperçu, « Valeurs par défaut ».
  Mémorisés (`localStorage`, clé `npfQ400AppTraceReglagesV1`).
- Trait de la trace en cours : calque sous la ligne rouge et le vecteur jaune ; un point dessiné
  si > 15 m ET (5 s ou virage > 8°) ; morceaux de 150 points (un nouveau point ne redessine que
  le dernier morceau).
- Traces passées : section « Traces de vol (NPF-Q400 APP) » dans « Gestion des Cartes » (bouton
  Cartes) — date, heure UTC de début, durée, points, trous ; « Afficher », « Exporter (GPX) »,
  « Supprimer » ; bouton « Réglages Trace ».
- GPX 1.1 `NPF-Q400_trace_AAAA-MM-JJ_HHMMZ.gpx` : latitude, longitude, altitude (si valide),
  heure UTC, vitesse et route en extension Garmin `TrackPointExtension` v2 (GPX 1.1 n'a pas de
  champ vitesse : décision) ; un segment par trou de plus de 30 s. Partage iPad (Fichiers,
  AirDrop, Mail).
- Partage iPad aussi pour les fichiers DIAG (`NPF_DIAG_*.txt`), KML et CSV feu de la PWA ; les
  autres partages de la PWA (BLOC/FUEL…) ne changent pas.

### Sécurité des données
- IndexedDB `npfQ400AppTracesV1` : fiche de trace + lots de points ; un lot au plus tard toutes
  les 25 s d'enregistrement (filet : toutes les 15 s), et à chaque passage en arrière-plan.
- Arrêt brutal : au relancement, la trace « en cours » est relue, complétée par le journal natif ;
  si son dernier point a moins de (durée d'arrêt + 5 min), elle **continue** ; sinon elle est
  close comme « retrouvée ». Message clair dans les deux cas.
- Trous de plus de 30 s : comptés, listés, dans le DIAG, dans la liste et dans le GPX.
- DIAG : section « NPF-Q400 APP — TRACE » à la fin de l'export (état, points reçus, dernier
  point, trace en cours, trous, dernier lot, dernière trace, réglages) + repères horodatés
  (démarrage, arrêt, trous, reprises du journal).

### Essais PC (`npm run test:web`) — 51 contrôles sur 51 OK
- Navigateur normal : identique à TEST v17.97 (bouton TRACE de TEST, pas de liste, DIAG et
  téléchargements intacts) ; GPS de la carte : tous les contrôles de la 0.4 verts.
- Mode app simulé, positions datées injectées :
  - réglages : appui long, valeurs par défaut, modification mémorisée, « Valeurs par défaut » ;
  - bouton : Raccourcis jamais lancé ; démarrage à la main (rouge) ; arrêt avec confirmation (gris) ;
  - vol complet (roulage 10 kt, 120 kt, remise de gaz 40 kt, écopage 75 kt, 300 s sans vitesse
    GPS, trou de 45 s, atterrissage 15 kt) : 1 trace, début exactement 2 min avant le passage à
    50 kt, fin 2 min après le passage sous 30 kt, 1 341 points, 1 trou, 300 vitesses calculées ;
  - arrêt à la main en vol : pas de redémarrage avant l'atterrissage, puis redémarrage et arrêt ;
  - mémoire : tampon ≈ 160 points après 30 min de roulage ; ≤ 7 points en attente ; 0,006 à
    0,02 ms par point ; 1 h de vol (3 720 points) = 144 lots, 748 points dessinés en 5 morceaux ;
  - arrêt brutal (20 points en attente perdus) : trace retrouvée et close avec 3 720 points et
    message ; relancement en plein vol : la trace continue et son trait est redessiné ;
  - GPX : XML valide, 1.1, 1 341 points avec altitude, heure UTC et vitesse, 2 segments, nom
    attendu ; « Exporter (GPX) » passe par la fenêtre de partage ;
  - Afficher une trace passée ; liste ; lignes « Trace » du DIAG ; partage DIAG / KML / CSV.

### Recette simulateur (déclenchée par le passage 0.4 → 0.5)
- Par orientation (paysage puis portrait), en ligne droite au cap 330° depuis Marignane :
  parking 30 s, roulage 5 m/s (≈ 10 kt) 40 s, vol 70 m/s (≈ 136 kt), app en arrière-plan
  60 s (Réglages d'iOS au premier plan), retour, ralentissement 12 m/s (≈ 23 kt) 150 s, arrêt.
- Ordres d'essai (fabrication Debug seulement) par `Documents/npfq400-essai.json` : cadrer la
  trace, Réglages Trace, liste, écrire le GPX dans Documents, exporter.
- Bilan : démarrage / arrêt avec l'heure relative, lots, reprises du journal, points du GPX
  pendant l'arrière-plan et plus grand écart, XML du GPX (`xmllint`).
- Captures : 10 s, 25 s, vol (bouton rouge, trait), arrière-plan, retour, trace terminée,
  Réglages Trace, liste des traces, fenêtre de partage du GPX. Durée prévue : ≈ 7 min par
  orientation (limite du travail portée à 100 min).

### Non vérifiable sans iPad réel
- Comportement réel d'iOS en vol : écran verrouillé longtemps, iPad chaud, batterie, coupure
  par iOS ; première demande d'autorisation (iOS propose d'abord « Pendant l'utilisation » ;
  avec le mode arrière-plan, la trace continue quand même tant que l'app a été ouverte) ;
  « Autoriser une fois » couperait la trace à la fermeture de l'app.
- Fenêtre de partage réelle (Fichiers, AirDrop, Mail) et ouverture du GPX dans d'autres apps.

---

## 16/11/2026 — v0.4 : résultats GitHub et recette simulateur plus robuste

### Runs du commit `edde0de` (GPS natif, appartient à la 0.4)
- Fabrication sans signature : **échec sans rapport avec l'app** (run 43946247610) : GitHub n'a
  trouvé aucun Mac libre en 15 min (« capacity constraints… macOS arm64 ») et a annulé le travail
  avant son début. Non relancé : la 0.4 (`59ca3f1`) contient ce code et a été fabriquée.
- Essai simulateur : **vert** (run 43946247624). Plus de seconde question « localhost » ; la PWA
  reçoit la position (Marignane fixe) ; « Survolée : Marignane (13) » ; carte centrée.
  **VALIDÉ (simulateur)**.

### Runs de la 0.4 (`59ca3f1`)
- Fabrication sans signature : **verte** (run 43948993951, 20:21 → 20:33 UTC, dont l'attente d'un Mac).
- Essai simulateur : **vert** (run 43948994076, 20:21 → 20:41 UTC), iPad (9th generation), iOS 26.5.
  - **Paysage** : trajet simulé Marignane → Salon à 60 m/s. Contrôle GPS de 14 s :
    **15 positions, écart médian 1010 ms** (min 565, max 1053) ; vitesse présente 15/15 (60 m/s) ;
    cap présent 15/15 (329°, route suivie vers Salon) ; précision 15/15 ; heure en ms, reçue
    45 ms après la mesure ; altitude vide 15/15 (le trajet simulé d'iOS ne donne pas d'altitude
    valide : Safari la laisserait vide aussi) ; aucune erreur. Options envoyées au plugin :
    haute précision, délai 30 s. Le tracé jaune du trajet s'affiche sur la carte. **VALIDÉ (simulateur)**.
  - « Survolée : non déterminée » pendant le trajet : texte de la PWA quand la position n'est dans
    aucune commune connue ; la dernière position (43,456 N 5,199 E) est au-dessus de l'étang de
    Berre — explication probable, **non vérifiée**. Comportement de TEST, pas de l'app.
  - **Portrait : l'app ne s'est pas ouverte**. L'icône « NPF-Q400 APP » (icône de la PWA) est
    bien sur l'écran d'accueil, mais `simctl launch` est resté bloqué sans lancer l'app (aucune
    ligne de console, pas de plantage). Mac GitHub très chargé ce soir-là (6 min pour démarrer
    un simulateur). **À REVOIR** : relancer l'essai.
- Correction de la recette (`scripts/sim-test.sh`) : après chaque lancement, vérification que
  l'app tourne ; sinon, 2e lancement au bout de 20 s, noté dans le bilan. Version de l'app
  inchangée (0.4) : ce push ne lance pas l'essai simulateur ; il sera lancé à la main.

---

## 16/11/2026 — v0.4 : GPS par le plugin natif, contenu identique au GPS de Safari

### Numéro de version
- Le commit `edde0de` (GPS par le plugin natif `@capacitor/geolocation`) a été poussé en
  gardant le numéro 0.3 : erreur reconnue par l'utilisateur. **`edde0de` appartient à la 0.4.**
  Correction sans réécrire l'historique : ce commit passe l'app en **0.4 (build 4)**.
  La 0.3 = `e1a89a4` seul (texte d'autorisation de position).

### Comparaison plugin GPS / GPS de Safari (lecture des sources)
- Safari = WebKit, `GeolocationPositionDataCocoa.mm` et `CoreLocationGeolocationProvider.mm` ;
  plugin = `@capacitor/geolocation` 8.2.4 + bibliothèque `ion-ios-geolocation` 3.0.0.
- Déjà identiques : latitude, longitude, précision horizontale (`accuracy`), heure en ms,
  haute précision = `kCLLocationAccuracyBest`, aucun filtre de distance → même cadence d'iOS
  (≈ 1 position par seconde).
- Différents dans le plugin brut, corrigés dans la couche app (section 7) :
  1. **cap** : le plugin met d'abord la BOUSSOLE de l'iPad (direction où pointe l'iPad) ;
     Safari donne la ROUTE SUIVIE (`course`). → la couche app prend `course`, vide si invalide ;
  2. **vitesse** : -1 si invalide dans le plugin → vide (null) comme Safari ;
  3. **altitude / précision verticale** : transmises même invalides → vides si la précision
     verticale est invalide, comme Safari ;
  4. **maximumAge** ignoré par le plugin → la couche app rend la dernière position si elle est
     assez récente, comme Safari ;
  5. **suivi + délai dépassé** : le plugin arrêtait le suivi → la couche app transmet l'erreur
     puis relance le suivi, comme Safari qui continue ;
  6. **pas de délai donné** : le plugin attendait 5 s → pas de limite (24 h), comme Safari.
- Haute précision : envoyée au plugin pour CHAQUE appel (le plugin n'a qu'un réglage commun ;
  une demande ponctuelle sans haute précision aurait dégradé le suivi en cours à 3 km).
  Différence restante assumée : une demande ponctuelle « basse précision » reçoit la meilleure
  précision (Safari : 100 m). Toutes les demandes de TEST v17.97 sauf une sont déjà en haute
  précision.
- Différence non corrigée : `floorLevel` (étage) de Safari n'existe pas dans le plugin ; la PWA
  ne l'utilise pas.

### Contrôles
- Statistiques GPS dans le rapport de démarrage (`gps`) : positions reçues, options demandées,
  options envoyées au plugin, dernière position, écarts entre positions du suivi.
- **Contrôle GPS de 14 s** (DIAG) : seulement en fabrication Debug (simulateur) et en essai PC,
  jamais dans l'app livrée ; 3 s après le chargement, un suivi avec les options de la PWA
  mesure la cadence et les champs reçus.
- Simulateur : trajet Marignane → Salon → Avignon à 60 m/s (≈ 117 kt), 1 position par seconde
  (`simctl location start`), repli sur une position fixe ; résumé GPS lisible dans `bilan.txt`.
- Essais PC : **31 contrôles sur 31 OK**. Le plugin est imité avec ses données BRUTES
  (boussole 90°, route 335°, une position sur 5 avec vitesse/route/altitude invalides) :
  - champs reçus par la PWA : `accuracy, altitude, altitudeAccuracy, heading, latitude,
    longitude, speed` + `timestamp` en ms ;
  - position valide : cap 335 (route, pas la boussole 90), vitesse 60, altitude 300 ;
  - position invalide : cap, vitesse, altitude, précision verticale vides ;
  - haute précision envoyée au plugin même pour une demande basse précision ; sans délai →
    86 400 000 ms ;
  - maximumAge : même position rendue sans nouvel appel au plugin ;
  - suivi : 6 positions en 5,6 s, écart médian 998 ms, rien après l'arrêt ;
  - contrôle de 14 s : 15 positions, écart médian 1000 ms (993 à 1011).
- **non vérifié** : cadence réelle d'iOS sur iPad en vol ; le simulateur dira la cadence du
  trajet simulé.

### Essai simulateur : quand
- Ne se lance plus à chaque push : seulement **à la main** ou quand un push **change la
  version** (champ `version` de `package.json`). Petite tâche Linux de 1 min qui compare la
  version avant/après le push. La fabrication sans signature reste lancée à chaque push.

---

## 16/11/2026 — v0.3 : autorisation de position GPS

- Décision de l'utilisateur (« OK push + GPS ») après le constat de la 0.2 : iOS refusait la
  position car l'app ne déclarait pas pourquoi elle l'utilise.
- `Info.plist` : `NSLocationWhenInUseUsageDescription` = « NPF-Q400 APP utilise la position de
  l’iPad pour afficher l’avion sur la carte et calculer les distances, les caps et les
  terrains les plus proches. » (texte montré par iOS dans la demande d'autorisation).
  Position « pendant l'utilisation » seulement : la position en arrière-plan viendra avec la
  trace (pas encore demandée).
- Autres autorisations iOS : aucune nécessaire pour l'instant (choix de fichiers zip/PDF sans
  appareil photo ; notifications web indisponibles dans l'app).
- Version 0.3 (`MARKETING_VERSION = 0.3`, build 3, `LAYER_VERSION = '0.3'`).
- Essai simulateur : autorisation de position accordée d'avance et position simulée
  (Marignane, 43.4367 N 5.2150 E) ; le bilan dit si iOS signale encore le texte absent ; le
  rapport de démarrage ajoute le texte « Survolée » de la PWA.
- Essais PC : 21 contrôles sur 21 OK (rapport : « Survolée: GPS en attente », normal sur PC
  sans position).
- Le push du journal `f3fd601` a relancé les deux recettes : fabrication verte (run 43939422912),
  essai simulateur vert (run 43939418730, ≈ 15 min).

### Premier essai de la 0.3 (commit `e1a89a4`, poussé après « OK push »)
- Fabrication sans signature : **verte**, run 43940213649 (≈ 2 min).
- Essai simulateur : **vert**, run 43940213791 (≈ 18 min), iPad (9th generation), iOS 26.5.
  Plus d'alerte iOS sur le texte de position ; plus d'écran blanc à 10 s (écran noir de
  lancement à 10 s, carte à 25 s) ; aucune erreur JS ; écran allumé OK.
- **Problème découvert** : iOS accorde bien la position à l'app, mais le moteur web (WKWebView)
  affiche EN PLUS sa propre question « « localhost » aimerait utiliser votre position
  actuelle » (capture portrait 40 s). Tant qu'on ne touche pas « Autoriser », la PWA reste sur
  « GPS en attente ». Apple ne fournit aucun moyen public de l'accorder d'office, et la
  question revient à chaque lancement de l'app.

### Correction (commit `edde0de`, poussé sous le numéro 0.3 — appartient en fait à la 0.4)
- Plugin `@capacitor/geolocation` 8.2.4 (position native iOS).
- Couche app, section 7 : dans l'app seulement, `navigator.geolocation` est remplacé par un
  équivalent (getCurrentPosition, watchPosition, clearWatch ; même format de position et
  d'erreur qu'un navigateur) qui lit la position par le plugin. Une seule autorisation : celle
  d'iOS. Les appels de la PWA (démarrage, suivi GPS, centrage…) ne changent pas.
- Rapport de démarrage : état du GPS, nombre de positions reçues, dernière erreur.
- Essais PC : 23 contrôles sur 23 OK. Navigateur normal : GPS du navigateur intact (comme
  TEST). Mode app simulé (position fixe Marignane) : position ponctuelle reçue, suivi reçu,
  plus rien après l'arrêt du suivi ; la PWA passe de « GPS en attente » à « Survolée :
  indisponible » (position reçue ; commune non trouvée sur PC, Internet coupé).
- **non vérifié** : GPS réel sur iPad ; position en arrière-plan (pas demandée).

---

## 16/11/2026 — v0.2 : essai simulateur iPad + premières adaptations

Base inchangée : NPF-Q400 TEST v17.97 (`web-test/` identique, vérifié par git).

### Adaptations (dans `app-layer/`, actives seulement dans l'app)
- **Bouton MAJ masqué et désactivé** : CSS `display:none` sur `#force-update-button`,
  `.force-update-button` (TEST) et `#boot-force-update-button` (pérenne), et tout clic sur
  eux est arrêté avant la PWA. Constat : TEST v17.97 n'a plus ce bouton dans sa page
  (retiré par un ancien commit de TEST) ; la règle sert pour la future base pérenne.
- **Écran allumé** (`@capacitor-community/keep-awake` 8.0.1) : dans l'app,
  `navigator.wakeLock` est remplacé par un équivalent qui pilote le plugin natif. Les
  déclencheurs restent ceux de la PWA : démarrage, retour au premier plan, premier geste,
  téléchargement de carte ; tout est relâché quand l'app passe en arrière-plan.
- **PDF** (VAC, PDF terrain, Doc PDF Réduite, Carte Fréquences OPS) : dans l'app, la
  fenêtre `window.open('', '_blank')` est remplacée par une fenêtre factice ; l'adresse du
  PDF est lue et affichée dans la visionneuse PDF.js interne (`ouvrirNpfVisionneusePdf`,
  src/218), avec le titre « VAC xxxx » / « PDF xxxx ». Si le fichier n'est pas un PDF ou
  n'est pas lisible : message « NPF-Q400 APP — ouverture … impossible ».
- **Icône** = icône du manifest de la PWA (`icons/icon-512x512.png`), agrandie en
  1024 × 1024 sans transparence (`scripts/make-icon.mjs`). Nom affiché « NPF-Q400 APP »
  (inchangé depuis la 0.1).
- **Barres iPadOS** (ajout lié au contrôle « barre du haut et boutons ») : la classe
  `npf-app-installee` de TEST est posée dans l'app → mêmes marges que la PWA installée
  (32 px en haut, 20 px en bas). Sans elle, seule la zone sûre annoncée par iOS était
  réservée.
- **DIAG** : erreurs JS relevées (`NPF_Q400_APP.jsErrors`) et rapport de démarrage écrit
  une fois dans la console 20 s après le chargement (taille, orientation, carte, barre,
  boutons, écran allumé, erreurs). Aucun envoi réseau.
- Version 0.2 (`MARKETING_VERSION = 0.2`, build 2).
- Non fait (non demandé) : trace en arrière-plan, téléchargements/partage (DIAG, KML,
  CSV), Chat, réglages NAS/VPS.

### Recette simulateur (`.github/workflows/ios-simulator-test.yml`, `scripts/sim-test.sh`)
- Mac `macos-26`, fabrication Debug pour le simulateur, sans signature. En Debug,
  Capacitor recopie la console et les erreurs JS de la page dans la sortie de l'app.
- iPad le plus proche de l'iPad 9e génération (ordre de préférence : 9e génération,
  10e génération, A16, Air 11 pouces…) ; le nom retenu est écrit dans `bilan.txt`.
- `simctl` ne sait pas tourner le simulateur : pour l'essai, la COPIE installée de l'app
  n'accepte qu'une orientation (paysage, puis portrait). Captures à 10, 25 et 40 s,
  détection d'écran blanc/noir, journal de l'app, bilan.
- Champ `source_ref` pour essayer un ancien commit (sert à refaire les captures de la 0.1).

### Essais PC (`npm run test:web`) — 21 contrôles sur 21 OK
- Chrome de Windows sans écran, réseau extérieur coupé, fenêtres autorisées
  (`--disable-popup-blocking`, comme un toucher sur l'iPad ; sans cela la PWA, faute de
  fenêtre, affiche le PDF à la place de la page — c'était le blocage du premier essai).
- Navigateur normal : page de l'app identique à TEST v17.97 (service worker, fenêtre de
  mise à jour, bouton MAJ, Wake Lock du navigateur, PDF en nouvel onglet, barre 0 px,
  boutons à 46 px du haut, mêmes serveurs tentés) ; aucune erreur JS.
- Mode app simulé : bouton MAJ masqué et clic bloqué ; demande d'écran allumé → `keepAwake`,
  relâche → `allowSleep` (plugin simulé sur PC) ; VAC et PDF terrain ouverts dans la
  visionneuse avec titre et page dessinée, sans onglet ; barre 32 px (boutons à 62 px) ;
  aucune erreur JS.

### Push et fabrications GitHub (après « OK push », commits `280cacf` + `0299c97`)
- Fabrication sans signature 0.2 : **verte**, run 43928421724, 18:24:11 → 18:26:03 UTC (≈ 2 min).
- Essai simulateur 0.2 : **vert**, run 43928421784, 18:24:11 → 18:50:38 UTC (≈ 26 min).
- Essai simulateur 0.1 : premier lancement **en échec** (run 43928466031) — mon erreur :
  numéro de commit abrégé (`280cacf`) refusé par `actions/checkout`. Relancé à la main avec
  le numéro complet, sans changement de code ni push : **vert**, run 43933223472,
  18:51:29 → 19:07:20 UTC (≈ 16 min).

### Résultats simulateur 0.1 / 0.2
- Simulateur : **iPad (9th generation)**, iOS 26.5, Xcode 26.6 (l'iPad visé existe).
- Les deux versions démarrent, en paysage et en portrait ; l'app tourne encore après 40 s ;
  la carte s'affiche (25 tuiles en paysage, 20 en portrait selon le rapport 0.2) ; la fenêtre
  de mise à jour PWA n'apparaît pas ; aucune erreur JS dans la console de l'app (0.1 et 0.2).
- **Écran blanc à 10 s en portrait** (0.1 et 0.2), carte affichée à 25 s ; en paysage, contenu
  déjà affiché à 10 s. Démarrage lent dans le simulateur du Mac GitHub (Debug, simulateur neuf) —
  durée sur un vrai iPad **non vérifiée**. **À MESURER** sur iPad.
- Fenêtre « Télécharger cartes VAC » (Oui / Non) affichée au premier lancement : question
  normale de la PWA au premier démarrage, ce n'est pas la fenêtre de mise à jour.
- **Écran allumé** : 0.1 → « Screen Wake Lock iPad indisponible: NotAllowedError » (le Wake Lock
  du navigateur ne marche pas dans l'app) ; 0.2 → « To Native -> KeepAwake keepAwake » et
  rapport « écran allumé » : l'adaptation fonctionne dans le simulateur. **VALIDÉ (simulateur)**.
- **Barre du haut** : 0.1 en portrait → pas de bande sombre, l'heure et la batterie sont posées
  sur la carte claire, le panneau du haut commence juste sous l'heure ; 0.2 → bande sombre de
  32 px, panneau et boutons sous la bande, rien de caché. Rapport 0.2 : boutons à 62 px du haut,
  bande 32 px, en paysage comme en portrait.
- **Paysage** : le simulateur reste tenu en portrait ; iPadOS 26 affiche alors l'app paysage
  réduite (≈ 75 %) au centre avec des bandes noires. La page, elle, a bien la taille paysage
  (1080 × 810). Une vraie rotation du simulateur n'est pas possible avec `simctl` —
  **À REVOIR** (essai de rotation par le menu du Simulateur si on veut une capture plein écran).
- **GPS** : iOS signale « NSLocationWhenInUseUsageDescription » absent dans l'`Info.plist` →
  dans l'app, la position GPS est refusée par iOS tant que ce texte n'est pas ajouté
  (0.1 et 0.2). **NON IMPLÉMENTÉ** — à faire en priorité (simple ajout dans `Info.plist`).
- PDF dans la visionneuse : vérifié sur PC seulement ; dans le simulateur **non vérifié**
  (pas de VAC téléchargée, aucun toucher automatique).
- Appels NAS/VPS depuis l'app : non sollicités par l'essai ; **non vérifié** (attendu en échec
  tant que l'origine `capacitor://localhost` n'est pas autorisée côté serveur).

### Contrôles de fin
- `web-test/` identique à la 0.1 ; NPF-Q400 pérenne : `git status` identique au départ.
- NPF-Q400 TEST : `git status` **différent** du départ : 9 fichiers modifiés non commités
  (v17.98 en cours, modifiés à 19:43 heure de Paris). Pas de mon fait : pendant cette étape,
  seules des commandes de lecture ont été lancées sur TEST. Rien n'a été touché ni annulé.

---

## 16/11/2026 — v0.1 : première fabrication GitHub sans signature — VALIDÉ

- Premier push (commit `a628705`) après « OK push ». Avertissement GitHub attendu :
  `communes.json` 59 Mo (> 50 Mo recommandés, < 100 Mo limite).
- Run https://github.com/grisonb/NPF-Q400-APP/actions/runs/43913369604 : **vert**,
  16:58:36 → 17:00:01 UTC, soit environ **1,5 minute**. Mac macOS 26.7.2, Xcode 26.6.
- `** BUILD SUCCEEDED **` ; un seul avertissement, sans conséquence (AppIntents non utilisé).
- Artefact `NPF-Q400-APP-0.1-non-signe` (24,7 Mo, conservé jusqu'au 16/12/2026) :
  `.ipa` non signé + journal `xcodebuild`. Téléchargé et contrôlé sur le PC :
  nom « NPF-Q400 APP », `com.grisonb.npfq400app`, version 0.1 (build 1), iPad seul
  (`UIDeviceFamily = [2]`), 4 orientations, iOS 15 minimum, `public/index.html`
  contient bien la couche app (base v17.97). Pas de signature (normal).
- **non vérifié** : lancement de l'app (ni simulateur, ni iPad) ; le `.ipa` non signé ne
  peut pas être installé sur un iPad.
- Profils Chrome temporaires des essais PC laissés dans `C:\Windows\Temp\npfq400app-essai-*`
  (non supprimés, pour ne rien toucher sous `/mnt`).

---

## 16/11/2026 — v0.1 : création du projet (sans compte Apple, sans signature)

### Base
- NPF-Q400 TEST **v17.97**, commit `1884639` (`188463995e34d607526123967fc97eefcfb94bab`),
  dernière version poussée sur `grisonb/NPF-Q400-TEST` (branche `main`, contrôlé par
  `git ls-remote` : identique au commit local).
- Copie par `git archive` du commit (lecture seule de TEST) dans `web-test/` :
  32 fichiers web, 112 Mo, tous identiques octet par octet au commit (`git hash-object`).
- Non copiés (pas des fichiers web) : `.github/`, `.gitignore`, `.nojekyll`, `CLAUDE.md`,
  `NPF_Q400_LOG.txt`, `tools/`, `src/` (sources de `script.js`), `icons/Thumbs.db`.
- Plus gros fichier : `communes.json` 60 Mo (sous la limite GitHub de 100 Mo ; GitHub
  affiche un simple avertissement au-delà de 50 Mo).

### Projet Capacitor
- Capacitor **8.6.2** (`@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`, versions exactes),
  iOS uniquement, projet Xcode en Swift Package Manager (pas de CocoaPods).
- Nom « NPF-Q400 APP », identifiant `com.grisonb.npfq400app`, version 0.1
  (`MARKETING_VERSION = 0.1`, build 1), iOS 15 minimum (valeur Capacitor 8).
- iPad uniquement (`TARGETED_DEVICE_FAMILY = 2`), 4 orientations : le manifest de la
  PWA n'impose aucune orientation.
- Ajustements de `Info.plist` : langue `fr`, `arm64` au lieu de l'ancien `armv7`.

### Couche app (`app-layer/npf-q400-app.js`)
- Ajoutée par `scripts/build-www.mjs` en tête de `<head>` de `www/index.html` (une ligne) ;
  `web-test/` n'est pas modifié.
- Détection : `Capacitor.isNativePlatform()` ou protocole `capacitor:`. Simulation pour
  essais PC : `?npfq400app-sim=1`, acceptée seulement sur localhost/127.0.0.1.
- Dans l'app : `window.NPF_Q400_APP`, classe `html.npf-q400-app` ; service worker
  masqué (`'serviceWorker' in navigator` devient faux, la PWA ne l'enregistre donc pas) ;
  fenêtres « Mise à jour » et « Mise à jour installée » masquées puis retirées.
- Hors de l'app : ne fait rien.
- Bouton « MAJ » du menu : laissé visible dans l'app pour l'instant. Dans l'app il ne
  fait que recharger la page. Décision du 16/11 : le **masquer ou le désactiver** dans
  l'app lors de l'étape des adaptations — **NON IMPLÉMENTÉ**.

### Décision du 16/11 : origine du contenu web
- À moyen terme, l'app sera une copie de **NPF-Q400 pérenne**, pas de TEST.
- Les essais se font sur la copie figée de TEST. Une fois l'app validée sur iPad, une
  version de l'app sera faite à partir de la pérenne, après que la pérenne aura reçu
  les fonctions qui lui manquent — **À FAIRE plus tard**.

### Dépôt GitHub
- Clé de l'API SafeSky présente dans `web-test/script.js` : déjà publique dans
  NPF-Q400 TEST et dans la pérenne (dépôts publics) ; conservée telle quelle (copie figée),
  signalée à l'utilisateur avant la création du dépôt.
- Dépôt public `grisonb/NPF-Q400-APP` créé le 16/11 après « OK » de l'utilisateur.

### Recette GitHub Actions (`.github/workflows/ios-build-unsigned.yml`)
- Mac `macos-26` (disponible officiellement chez GitHub depuis le 26/02/2026), Node 24,
  `npm ci`, `build-www`, `npx cap sync ios`, `xcodebuild` Release iphoneos avec
  `CODE_SIGNING_ALLOWED=NO`, puis `.ipa` non signé + journal `xcodebuild` en artefact (30 jours).
- Lancement à chaque push sur `main` et à la main (`workflow_dispatch`).
- Aucun secret utilisé.

### Essais sur PC (`npm run test:web`)
- Chromium de Playwright sous WSL : **ABANDONNÉ** (bibliothèque système `libnss3`
  absente, installation système non demandée). Remplacé par le Chrome de Windows sans
  écran, profil temporaire.
- Réseau extérieur coupé par `--host-resolver-rules` : la page a tenté de joindre
  `grisonb.synology.me`, `grisonb.github.io`, `raw.githubusercontent.com`,
  `cdn.jsdelivr.net`, `a.tile.openstreetmap.org`, `etalab-datasets.geo.data.gouv.fr`
  — tous bloqués (aucun accès NAS/VPS).
- Résultat : 12 contrôles sur 12 OK — aucune erreur JS dans les 3 pages ; page de l'app
  en navigateur normal identique à TEST (service worker enregistré et actif, fenêtre de
  mise à jour affichée, même titre/version, mêmes serveurs tentés) ; mode app simulé :
  couche active, service worker invisible, fenêtre de mise à jour bloquée, carte présente.
- **non vérifié** : comportement réel dans l'app sur iPad (WKWebView, `capacitor://localhost`) ;
  la détection par `window.Capacitor` n'a été essayée qu'en simulation.

### Suite (sans compte Apple)
- Fabrication sans signature verte sur GitHub : voir l'entrée suivante.
- Étapes suivantes possibles : PDF, trace (`@capgo/background-geolocation`), écran allumé
  (`@capacitor-community/keep-awake`), icône de l'app (actuellement icône Capacitor par
  défaut — **NON IMPLÉMENTÉ**), essai dans le simulateur iPad sur le Mac GitHub.
