# NPF-Q400 APP — guide de contexte pour Claude Code

## Le projet

**NPF-Q400 APP** = la PWA **NPF-Q400 TEST** emballée dans une vraie app **iPad**
(Capacitor 8, iOS uniquement), fabriquée par les Mac de **GitHub Actions**
(l'utilisateur n'a pas de Mac), distribuée plus tard par **TestFlight**.

But final : enregistrer la trace de vol automatiquement en arrière-plan.

- Identifiant d'app : `com.grisonb.npfq400app` — nom affiché : « NPF-Q400 APP ».
- iPad uniquement (`TARGETED_DEVICE_FAMILY = 2`), 4 orientations (comme la PWA,
  dont le manifest n'impose aucune orientation).
- Version de l'app : **0.5.1** (`MARKETING_VERSION` + `CURRENT_PROJECT_VERSION` dans
  `project.pbxproj`, `package.json`, `LAYER_VERSION` dans `app-layer/`).
- Icône de l'app = icône de la PWA (`icons/icon-512x512.png` du manifest), refaite par
  `node scripts/make-icon.mjs` (1024 px, sans transparence).
- Version de NPF-Q400 TEST embarquée : voir `VERSION-BASE`.
- Dépôt GitHub **public** : `grisonb/NPF-Q400-APP`.

L'utilisateur n'est pas développeur : messages, rapports et journal **en français
simple**. Si quelque chose n'est pas vérifiable, écrire « non vérifié ».

## Organisation des fichiers

| Chemin | Rôle |
|---|---|
| `web-test/` | Copie **figée** de NPF-Q400 TEST (fichiers web). **Ne jamais modifier à la main.** Pour changer de version : nouvelle copie complète depuis un commit poussé de TEST + mise à jour de `VERSION-BASE` + entrée dans `JOURNAL.md`. |
| `app-layer/npf-q400-app.js` | Couche « app » séparée du code TEST. Ne fait rien hors de l'app. Dans l'app : service worker masqué, fenêtres de mise à jour et bouton MAJ bloqués, marges des barres iPadOS comme la PWA installée, écran allumé (KeepAwake), PDF dans la visionneuse interne, relevé des erreurs JS et rapport de démarrage dans la console. |
| `app-layer/npf-q400-app-trace.js` | Trace de vol (0.5) : source `@capgo/background-geolocation` + journal natif, démarrage/arrêt auto, IndexedDB `npfQ400AppTracesV1`, bouton TRACE, Réglages Trace, trait, liste dans « Gestion des Cartes », GPX, partage iPad (GPX, DIAG, KML, CSV feu), DIAG. Inactif hors de l'app. |
| `scripts/patch-plugins.mjs` | Correctif de plugin appliqué après chaque `npm ci` (`postinstall`, sans dépendance) : type d'activité « avion » de `@capgo/background-geolocation`. S'arrête en erreur si le plugin a changé : revoir le correctif à chaque changement de version du plugin. |
| `scripts/build-www.mjs` | Fabrique `www/` = `web-test/` + `app-layer/` + deux lignes `<script>` (couche app puis trace) ajoutées en tête de `<head>` de `index.html`. |
| `scripts/test-web.mjs` + `scripts/test-probe.js` | Essais sur PC (Chrome de Windows sans écran, réseau extérieur coupé) : TEST d'origine, page de l'app en navigateur normal, mode app simulé (`?npfq400app-sim=1`, localhost seulement). La sonde n'est injectée que par le serveur d'essai. |
| `scripts/sim-test.sh` | Essai simulateur iPad sur le Mac GitHub (paysage + portrait, captures, console de l'app). |
| `scripts/make-icon.mjs` | Icône de l'app depuis l'icône de la PWA. |
| `www/` | Généré, non versionné. |
| `ios/` | Projet Xcode généré par Capacitor (Swift Package Manager, pas de CocoaPods). |
| `.github/workflows/ios-build-unsigned.yml` | Fabrication iOS sans signature sur `macos-26`, à chaque push sur `main` et à la main. |
| `.github/workflows/ios-simulator-test.yml` | Essai simulateur iPad : **à la main**, ou par un push sur `main` qui **change la version** de `package.json` (pas pour un simple journal). Champ `source_ref` = numéro de commit COMPLET pour essayer un ancien commit. Trajet GPS simulé Marignane → Avignon à 60 m/s. |
| `VERSION-BASE` | Version et commit de NPF-Q400 TEST copiés. |
| `JOURNAL.md` | Journal cumulatif : nouvelle entrée en tête, rien n'est jamais effacé. |

## Commandes

```bash
npm ci                    # dépendances (uniquement dans ce dossier)
npm run build:www         # fabrique www/
npm run sync              # www/ + npx cap sync ios
npm run test:web          # essais Chrome sur PC
```

## Faits techniques établis (étude du 13/11/2026, NPF-Q400 TEST v17.97, commit 1884639)

- Dans l'app, l'origine est `capacitor://localhost`.
- Le service worker est inutilisable dans l'app : la couche app le masque
  (`'serviceWorker' in navigator` devient faux), la PWA ne l'enregistre donc pas.
- La carte hors ligne est lue directement dans IndexedDB.
- Plugins Capacitor appelés sans bundler : `Capacitor.nativePromise('<jsName>', '<méthode>', {})`
  (pont natif iOS). Plugins installés : `@capacitor-community/keep-awake` 8.0.1 (jsName `KeepAwake`),
  `@capacitor/geolocation` 8.2.4 (jsName `Geolocation`, `watchPosition` par `nativeCallback`).
- GPS : dans WKWebView, `navigator.geolocation` déclenche une 2e question « localhost » à chaque
  lancement (aucune API Apple publique pour l'accorder) → dans l'app, la couche app le remplace
  par le plugin natif. `NSLocationWhenInUseUsageDescription` est dans `Info.plist`.
- GPS : la PWA doit recevoir EXACTEMENT ce que donne Safari (WebKit `GeolocationPositionDataCocoa.mm`) :
  `heading` = route suivie (`course`), jamais la boussole ; `speed`, `altitude`, `altitudeAccuracy`
  vides si invalides ; heure en ms ; haute précision ; `maximumAge` respecté ; un suivi continue après
  un délai dépassé. Toute modification de la section 7 de la couche app doit garder ces contrôles
  (essais PC, contrôle GPS de 14 s en Debug).
- Trace (0.5) : deux flux GPS séparés — la carte = `@capacitor/geolocation` (0.4, ne pas toucher),
  la trace = `@capgo/background-geolocation` lancé à l'ouverture de l'app (`activityType: 'airborne'`
  via `scripts/patch-plugins.mjs`, journal natif `locationLog`). Le moteur travaille sur l'HEURE DES POINTS (pas
  l'horloge) : les essais PC injectent des positions datées. Ordres d'essai simulateur
  (`Documents/npfq400-essai.json`) actifs seulement en fabrication Debug (`Capacitor.DEBUG`).
- Fiabilité en vol : l'enregistrement ne doit jamais ralentir la carte ni faire grossir la mémoire
  en continu (tampon borné par le temps, lots en IndexedDB, trait allégé par morceaux de 150 points).
- Numéro de version : changer `package.json`, `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`
  et `LAYER_VERSION` ENSEMBLE, dans le même commit que le changement de l'app (sinon l'essai
  simulateur ne se lance pas et le journal se trompe de version).
- PDF de la PWA : `window.open('', '_blank')` puis `.location.href = blob:` ; la couche app
  rend une fenêtre factice et ouvre `ouvrirNpfVisionneusePdf(titre, blob)` (src/218).
- TEST v17.97 n'a plus de bouton `#force-update-button` dans la page ; la pérenne a
  `#boot-force-update-button`. Les deux sont masqués dans l'app.
- Plus tard : trace de vol par `@capgo/background-geolocation`, écran allumé par
  `@capacitor-community/keep-awake`, signature sans Mac par clé API App Store Connect.

## RÈGLES STRICTES

1. **NPF-Q400 TEST** (`/home/gsn/projects/NPF-Q400-TEST`) et **NPF-Q400 pérenne**
   (`/home/gsn/projects/NPF-Q400`) ne doivent pas changer : lecture seule, aucun
   commit, aucun push, aucun fichier modifié (pas même `git fetch`, qui écrit dans
   `.git` : utiliser `git ls-remote`). Vérifier en fin de session que leur
   `git status` est identique au départ.
2. Aucun accès au NAS ni au VPS, aucune modification serveur. Aucun fichier de `/mnt`.
3. Dossier de travail : `/home/gsn/projects/NPF-Q400-APP`. Installations npm
   autorisées uniquement dans ce dossier. Toute installation système (Node, apt…) :
   demander avant.
4. GitHub : création de dépôt seulement après « OK » tapé par l'utilisateur ; chaque
   push seulement après « OK push » tapé. **Jamais de `--force`.** Jamais de commit
   ni de push sans demande explicite.
5. Dépôt **public** : avant chaque push, vérifier qu'aucun mot de passe, code, clé,
   jeton ou fichier privé n'y est (même si le code TEST est déjà public). Aucune
   donnée de vol, aucun fichier de `/mnt` ni du NAS. Les futurs secrets Apple
   (clé `.p8`, certificats) vont **uniquement** dans les secrets GitHub, jamais dans
   le dépôt.
6. Tous les textes visibles : « NPF-Q400 », **jamais « NPF » seul**. Nom de l'app :
   « NPF-Q400 APP ».
7. Périmètre strict : ne faire que l'étape demandée. Étapes suivantes (PDF, trace,
   écran allumé, NAS/VPS, signature) seulement sur demande.
8. Ne jamais modifier `web-test/` : toute adaptation à l'app passe par `app-layer/`.
9. **Origine du contenu web : TEST pour les essais, pérenne à moyen terme.**
   À moyen terme, l'app devra être une copie de **NPF-Q400 pérenne** (pas de TEST).
   Les essais se font sur une copie figée de TEST (`web-test/`). Une fois l'app
   validée sur iPad, une version de l'app sera faite à partir de la pérenne, **après**
   que la pérenne aura reçu les fonctions qui lui manquent. Ne pas basculer vers la
   pérenne sans demande explicite.
10. Bouton « MAJ » masqué et désactivé dans l'app (fait en 0.2, via `app-layer/`).
    Pas encore demandé : trace en arrière-plan, téléchargements/partage (DIAG, KML, CSV),
    Chat, réglages NAS/VPS.
11. Journal `JOURNAL.md` cumulatif : nouvelle entrée en tête, historique conservé,
   statuts `NON IMPLÉMENTÉ`, `À MESURER`, `À DÉCIDER`, `ABANDONNÉ`, `À REVOIR`,
   `VALIDÉ`, `non vérifié`.
