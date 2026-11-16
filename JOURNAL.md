# NPF-Q400 APP — journal cumulatif

Nouvelle entrée en tête. Rien n'est jamais effacé (essais ratés et abandons compris).
Statuts : `NON IMPLÉMENTÉ`, `À MESURER`, `À DÉCIDER`, `ABANDONNÉ`, `À REVOIR`, `VALIDÉ`, `non vérifié`.

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

### Résultats simulateur 0.1 / 0.2
- Voir l'entrée suivante (après le push).

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
