# NPF-Q400 APP — guide de contexte pour Claude Code

## Le projet

**NPF-Q400 APP** = la PWA **NPF-Q400 TEST** emballée dans une vraie app **iPad**
(Capacitor 8, iOS uniquement), fabriquée par les Mac de **GitHub Actions**
(l'utilisateur n'a pas de Mac), distribuée plus tard par **TestFlight**.

But final : enregistrer la trace de vol automatiquement en arrière-plan.

- Identifiant d'app : `com.grisonb.npfq400app` — nom affiché : « NPF-Q400 APP ».
- iPad uniquement (`TARGETED_DEVICE_FAMILY = 2`), 4 orientations (comme la PWA,
  dont le manifest n'impose aucune orientation).
- Version de l'app : **0.1** (`MARKETING_VERSION`, `package.json`, `app-layer/`).
- Version de NPF-Q400 TEST embarquée : voir `VERSION-BASE`.
- Dépôt GitHub **public** : `grisonb/NPF-Q400-APP`.

L'utilisateur n'est pas développeur : messages, rapports et journal **en français
simple**. Si quelque chose n'est pas vérifiable, écrire « non vérifié ».

## Organisation des fichiers

| Chemin | Rôle |
|---|---|
| `web-test/` | Copie **figée** de NPF-Q400 TEST (fichiers web). **Ne jamais modifier à la main.** Pour changer de version : nouvelle copie complète depuis un commit poussé de TEST + mise à jour de `VERSION-BASE` + entrée dans `JOURNAL.md`. |
| `app-layer/npf-q400-app.js` | Couche « app » séparée du code TEST. Ne fait rien hors de l'app. |
| `scripts/build-www.mjs` | Fabrique `www/` = `web-test/` + `app-layer/` + une ligne `<script>` ajoutée en tête de `<head>` de `index.html`. |
| `scripts/test-web.mjs` | Essais sur PC (Chrome sans écran) : mode app simulé et mode navigateur. |
| `www/` | Généré, non versionné. |
| `ios/` | Projet Xcode généré par Capacitor (Swift Package Manager, pas de CocoaPods). |
| `.github/workflows/ios-build-unsigned.yml` | Fabrication iOS sans signature sur `macos-26`, à chaque push sur `main` et à la main. |
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
10. Étape des adaptations de l'app (à faire, pas encore demandé) : **masquer ou
   désactiver le bouton « MAJ »** dans l'app (via `app-layer/`, sans toucher à `web-test/`).
11. Journal `JOURNAL.md` cumulatif : nouvelle entrée en tête, historique conservé,
   statuts `NON IMPLÉMENTÉ`, `À MESURER`, `À DÉCIDER`, `ABANDONNÉ`, `À REVOIR`,
   `VALIDÉ`, `non vérifié`.
