# Adaptive Harness V1 — plan de test complet

**Version du plan :** 2026-11-03 · **Référence :** [contrat d'acceptation](acceptance.md) · **Cible initiale :** OpenCode 2.x CLI et OpenCode lancé via T3 Code, Windows natif + Linux natif.

Ce document est le plan d'exécution, **pas une attestation de succès**. Chaque test doit être marqué `PASS`, `FAIL`, `BLOCKED` ou `INCONCLUSIVE` avec preuve horodatée. Les étapes qui nécessitent OpenCode/T3, une configuration système ou un moteur de replay isolé ne sont **pas** validées par les tests synthétiques CI. Les tests Codex sont explicitement différés (ADR-0009).

## 1. Contrat de livraison et critères d'arrêt

Le harness est un compagnon local : **pas de patch T3, pas de deuxième orchestrateur, pas de proxy OAuth, pas de capture de transcripts bruts, pas de code exécutable auto-généré**. L'observation et l'injection restent fail-open. Les publications skill/rule exigent une preuve de replay baseline/candidat **et** une régression sans dégradation. À défaut, l'évaluation est `inconclusive` et la publication est refusée.

**Gate G0 — fondations :** schémas OpenAPI/JSON, migrations SQL, typecheck Windows/Linux, tests unitaires et smoke processus verts.  
**Gate G1 — branchement provider :** OpenCode CLI/T3 observés sur Windows et Linux, callbacks avant/après outil, injection et découverte de skill. Filtration des sous-agents honnête : parent inconnu = `null`.  
**Gate G2 — fiabilité/sécurité :** arrêt daemon avant/pendant session, spool/rejeu, crash/recovery, scopes, auth locale, droits Windows/Linux, privacy, drift.  
**Gate G3 — apprentissage/publication :** preuves réelles corrélées, évaluation reproductible sur workspace isolé, garde de régression, publication atomique, rollback et reload natif observé.  
**Gate G4 — GUI :** appairage unique, session navigateur, filtres scopes, paging, synchronisation, affichage sécurisé, absence de modification des agents.  
**Gate G5 — sortie :** NFR mesurées, sauvegarde/restauration, rapport d'acceptation complet, limites explicites, non-régression T3 sans Harness.

Une gate échouée bloque la revendication « release-ready » ; ne pas remplacer une preuve manquante par une hypothèse ou une donnée simulée.

## 2. Environnements et matrice d'exécution

| Axe | Valeurs obligatoires | Observation |
| --- | --- | --- |
| OS | Windows 11 natif, Linux natif (Ubuntu LTS) | WSL 2 = environnement distinct, non substituable |
| Node | 24 LTS + patch exact | `node --version` |
| Provider | OpenCode 2.x, version exacte | `opencode --version` |
| Lanceur | OpenCode CLI directe, serveur OpenCode via T3 | Version T3, méthode de lancement, projet effectif |
| Configuration | Projet enregistré, plugin projet, plugin utilisateur si testé | Résolution du plugin et priorité réelle |
| Daemon | actif, arrêté avant l'appel, tué pendant l'appel, redémarré | PID/port local, aucune requête distante |
| Données | deux projets synthétiques A/B, trois sessions, 2 sous-agents si exposés | Ne pas tester sur source client |
| Évaluation | sans ReplayPort, ReplayPort fixture indépendante, régression fausse | Default fail-closed |
| GUI | navigateur récent Chromium/Firefox, normal + session privée | Cookie local, no-cache, refresh, panne |

Pour chaque couple OS/lanceur, enregistrer la version, le support observé de `session_events`, `tool_before`, `tool_after`, `subagent_lifecycle`, `context_injection`, `skills_read`, `config_reload`, `synchronous_block`, et leurs références d'événement. **Unknown** n'est pas **supported**.

### Préparation des fixtures

1. Installer Node 24, OpenCode 2 et, pour les scénarios T3, une version de T3 qui peut lancer OpenCode. Consigner les versions.
2. Cloner le dépôt à un **SHA de commit figé** dans un répertoire de test ; créer deux répertoires de projet sans données métier.
3. Utiliser un `ADAPTIVE_HARNESS_HOME` **temporaire**, indépendant des profils réels OpenCode/T3. Ne jamais copier les credentials d'un utilisateur.
4. Placer un `README.md` synthétique, un script `fail.mjs` retournant 1, un `verify.mjs` retournant 0 seulement après correction de `fixture.txt`.
5. Enregistrer les projets via la CLI ; faire `install` en preview puis `--apply` pour le seul projet fixture ; récupérer les IDs du retour. Ne jamais modifier un plugin existant sans plan.
6. Démarrer le daemon ; lancer les scénarios OpenCode directs et T3 sur **le même** projet fixture ; conserver les identifiants natifs.
7. Exécuter les tests négatifs d'isolation sur projet B ; redémarrer le service avant la validation de durabilité.
8. Faire `uninstall` preview puis `--apply`. Contrôler que les autres plugins, paramètres, hooks et les deux arborescences de projets ne sont pas modifiés.
9. Purger exclusivement les répertoires de test. Examiner la liste des fichiers avant suppression.

Commande de base (racine du dépôt, shell Bash) :

```bash
# Exécution hors réseau et sans appel de modèle pour la phase synthétique.
npm install --ignore-scripts
npm run check
npm test
npm run test:smoke
python -m unittest discover -s tests -v

# Phase provider réelle sur une fixture approuvée.
export ADAPTIVE_HARNESS_HOME="$(mktemp -d)"
node --experimental-strip-types apps/cli/src/main.ts project register --root /path/to/synthetic-project
node --experimental-strip-types apps/cli/src/main.ts install --provider opencode --scope project --root /path/to/synthetic-project
node --experimental-strip-types apps/cli/src/main.ts install --provider opencode --scope project --root /path/to/synthetic-project --apply
node --experimental-strip-types apps/cli/src/main.ts daemon start
# Dans une deuxième fenêtre :
node --experimental-strip-types apps/cli/src/main.ts ui
node --experimental-strip-types apps/cli/src/main.ts doctor --provider opencode --launcher cli --json
```

Windows PowerShell : créer `$env:ADAPTIVE_HARNESS_HOME = Join-Path $env:TEMP 'adaptive-harness-fixture'`, puis exécuter les mêmes commandes Node. Employer un dossier temp sans données utilisateur. Pour la campagne T3, vérifier explicitement le plugin **effectivement chargé** : ne pas déduire son chargement à partir de l'installation seule.

## 3. Traçabilité des tests fonctionnels

| ID | Test et manipulation | Oracle / résultat attendu | Exécution |
| --- | --- | --- | --- |
| AT-001 | Preview, install deux fois, modifier plugin, uninstall deux fois ; conserver un plugin tiers et les commentaires de config | Idempotence ; aucun écrasement non géré, refus en cas de dérive | CI + natif |
| AT-002 | Doctor dans CLI/T3, sans lancer de commande agent | Versions, provenance, portée et capacités inconnues non inventées | CLI/T3 |
| AT-003 | POST fixture canonique /v1/events, inspection DB | 202, séquence, seules les métadonnées autorisées persistées | CI/smoke |
| AT-004 | Rejouer le même ID/payload, puis changer une valeur, puis schéma V2 | 200 même séquence, 409, 400 | CI/smoke |
| AT-005 | Sous-agent avec parent exposé, puis sans parent exposé | Parent corrélé uniquement s'il est réellement fourni ; sinon null | Native |
| AT-006 | Codex CLI et T3 | **DEFERRED** par ADR-0009, ne bloque pas OpenCode V1 | Future |
| AT-007 | OpenCode direct et T3, exercice fail/repair et contexte | Plugin chargé, outils pré/post, injection et découvertes vérifiables | Native |
| AT-008 | Arrêt daemon avant et pendant appels, délai forcé, disque spool saturé | Opération agent continue ; spool borné/drop, pas d'exception propagée | Native/panne |
| AT-009 | Crash après commit event avant worker ; lease expiré ; rejouer | 1 effet logique, pas de perte ni de duplication | CI + panne |
| AT-010 | Échec outil → succès observé signature identique et cas succès absent | Une leçon citée ; sans succès : aucune réparation prétendue | CI + Native |
| AT-011 | Recherche FTS et 5 items / 600 tokens ; réponse serveur >100ms | Published only, limite respectée ; timeout = aucun contexte | CI + Native |
| AT-012 | Projet A/B avec faits contradictoires, tentative globalisation | A ne voit jamais B ; globalisation refusée sans preuves/politique | CI + Native |
| AT-013 | Même proposal key/digest/evidences, puis nouvelle révision | Dédoublonnage puis nouvel objet immuable | CI |
| AT-014 | Replay baseline échoue, candidat passe, régression passe ; variantes dégradée/inconnue | Éligible uniquement en cas d'amélioration mesurée sans dégradation | CI fixture + runner réel |
| AT-015 | Version skill, vérifier digest/Git, éditer cible, rollback | Publication gérée ; drift refusé ; rollback vers révision vérifiée | CI fixture + Native |
| AT-016 | Inference disabled puis plafond atteint | Observation continue ; zéro appel inférence non configuré | CI + Native |
| AT-017 | Trois échecs identiques, puis modification entrée et succès | Signal pour boucle fixe ; pas de signal après correction | CI + Native |
| AT-018 | Capability synchronous_block unknown/disabled, puis verified & enabled si provider le permet | Aucun blocage sans preuve et opt-in, exécution reste fail-open | Native |
| AT-019 | Listes API/CLI par scope, token absent, audit/reports | Accès authentifié, project-scoped, métriques cohérentes | CI + GUI |
| AT-020 | Windows/Linux : permissions fichiers, loopback, chemins, install/uninstall | Profil OS distinct, ACL actuelle uniquement, pas de bind public | Native |
| AT-021 | T3 avec et sans Harness, suppression du plugin, redémarrage T3 | Aucun changement core, démarrage et tâches non impactés | Native |
| AT-022 | Insérer instructions adverses et chaînes ressemblant à secrets | Rejet/sanitization ; jamais promu en code exécutable ou instructions fiables | CI + Red team |
| AT-023 | Couper processus pendant staging/atomic rename/versioning | Ancien artefact intact ou récupéré, jamais de publication déchirée | Panne |
| AT-024 | Publication skill et sessions en vol / suivantes | Version stable en session ; nouvelle version selon reload natif vérifié | Native |
| AT-025 | GET /health sans token ; tous endpoints données sans/faux token, origin hostile | Santé sans données, 401 / 403 ailleurs, pas de CORS | CI/smoke |
| AT-026 | Modifier projectId/sourceInstanceId dans event/context | 403 ; aucune lecture inter-projet | CI |
| AT-027 | Idempotence événements arrivés hors ordre, redelivery, redémarrage | Statut terminal cohérent ; aucune double facturation/learning | CI + panne |
| AT-028 | Codex + OpenCode concurrent | **DEFERRED** (partie multi-provider) ; tester OpenCode concurrent si disponible | Future |

Les lignes « CI » décrivent la couverture ciblée, **pas** le statut de l'ensemble du scénario. AT-008, 015, 023, 024, 027 ont une part de faute injection native à démontrer. Les tests synthétiques de runner ne prouvent pas un moteur d'exécution isolé en production.

## 4. GUI locale — matrice dédiée

| ID | Manipulation | Oracle |
| --- | --- | --- |
| UI-001 | Ouvrir /ui, /ui/app.js et /ui/api/overview sans session | 401 ; aucune donnée projet, aucune ressource chargée |
| UI-002 | Demander /v1/ui/pair sans bearer / avec faux bearer | 401 ; aucun lien émis |
| UI-003 | CLI `ui` → lien de 60 secondes ; ouvrir puis réouvrir | 303 vers /ui + cookie ; deuxième ouverture 401 |
| UI-004 | Vérifier cookie, headers HTML et JavaScript | HttpOnly, SameSite=Strict, Path=/ui, CSP sans inline/externe, no-store |
| UI-005 | Utiliser cookie sur /v1/status et /v1/events | 401 ; le cookie UI ne devient jamais un bearer |
| UI-006 | Tester Origin cross-site, requête POST sur UI, Host non local, CORS | 403, aucune écriture ou fuite |
| UI-007 | Sélectionner projet A, B, « Tous » | Vues, totaux et historiques correspondent strictement au scope choisi |
| UI-008 | Générer >100 événements, charger les pages successives | Aucun doublon, curseur décroissant, bornes serveur, états cohérents |
| UI-009 | Émettre session, tool, job, memory, proposal, evaluation, release, audit | Chaque classe visible dans sa section ; détails en lecture seule |
| UI-010 | Vérifier 4s polling, pause, reprise, actualisation manuelle, arrêt daemon | Nouveaux événements visibles, statut offline explicite, pas de gel |
| UI-011 | Injecter texte HTML/JS en nom de projet et descriptions synthétiques | Rendu texte uniquement ; aucun script exécuté / injection DOM |
| UI-012 | Fermer puis rouvrir, sessions privée et parallèle, expiration 2h, restart | Ré-authentification requise après expiration/restart, aucune persistance browser des credentials |

**Limite des métriques :** la GUI montre les événements et décisions **que le Harness a réellement enregistrés**. Elle ne peut pas montrer des étapes cachées du raisonnement d'un agent, des actions non observées, les commandes brutes ou du contenu jamais collecté. Les compteurs de coût sont des **estimations** issues des enregistrements d'inférence ; pas des factures provider.

## 5. Non-fonctionnel, charge et résilience

| Critère | Campagne | Seuil / contrôle |
| --- | --- | --- |
| NFR-001 | Interrompre daemon pendant 20 sessions natives | 0 erreur agent due au Harness, aucune tâche perdue imputable au collecteur |
| NFR-002 | 1 000 callbacks consécutifs, instrumenter durée native du hook | p95 inférieur à 15ms hors démarrage provider |
| NFR-003 | Latence réponse de contexte injectée à 200ms | Deadline 100ms par défaut ; 0 contexte ajouté |
| NFR-004 | POST 65 536B et 65 537B incluant headers JSON | Limite payload 64KiB, erreur 413 au-dessus |
| NFR-005 | Dépasser 10MiB / 5 000 entrées spool, redémarrer, vieillissement 24h | Limite conservée ; purge/overflow documentée ; absence de données brutes |
| NFR-006 | SIGKILL/Taskkill après HTTP 202 et pendant lease | Aucun event accepté perdu ; effects idempotents |
| NFR-007 | Exécuter 500 requêtes A/B alternées | 0 donnée B en contexte A |
| NFR-008/009 | Hasher version publiée ; proposer executable hook / MCP / secrets | Preuve+digest+rollback disponibles ; auto-publication dangereuse refusée |
| NFR-010/011 | Toute API, localhost scanner, bloquer réseau externe | /health seul anonyme ; aucune requête cloud nécessaire |
| NFR-012/013 | Install/doctor/uninstall répétés Windows et Linux | Perms et profils OS ; aucun fichier non géré touché |
| NFR-014 | DB vierge, redémarrage, replay migration, sauvegarde/restauration | Migration monotone ; integrité FK/FTS et refs ; backup API valide |
| NFR-015/016 | Inference disabled, changements de version provider | Zéro coût collecte ; capacité doctor fondée sur observations |

Campagne de charge supplémentaire : faire évoluer le nombre d'événements et de projets (1, 10, 100), mesurer le temps de transaction SQL, p95/p99 ingestion, saturation queue, mémoire RSS, taille de DB et temps de récupération après redémarrage. Ne pas supposer qu'un cache hit indique une amélioration. Exécuter une session soak de 24h avec rotations, spool et reprise ; rapporter le profil de charge réel.

## 6. Fautes injectées et scénarios adversariaux

- Daemon absent au démarrage, stoppé entre callbacks, socket inaccessible, requête qui ne répond jamais, token rotaté, discovery périmée.
- Spool non inscriptible, plein, corrompu, partiellement écrit, événement duplicate, expiration 24h, redelivery interrompue.
- SQLite : FK violée, disque plein, WAL tronqué en fixture, transaction rollback, schema futur inconnu, lease concurrent.
- Publieur : interruption entre stage / Git commit / remplacement natif / commit DB ; cible modifiée par un humain ; version précédente absente.
- Sécurité : Origin hostile, Host forgé, code d'appairage rejoué, cookie usurpé/expiré, paramètres SQL, ID projet inventé, XSS, code inline, HTML injecté, prompts adverses.
- Learning : échec sans réparation, corrélation incorrecte de sous-agent, même signature sur autre projet, test initial incohérent, baseline impossible, runner absent, score égal/régression.
- Privacy : chemin home, clé API factice, e-mail, transcript, commande shell ou texte de client dans un événement/rapport ; aucune fuite dans SQL, UI, spool, CI ou logs.

Pour chaque faute injectée, capturer **état initial, point d'injection, statut agent, statut collecteur, état post-redémarrage et invariant validé**.

## 7. Exécutions et preuves à produire

### Commandes automatisées

```bash
npm run check                 # TypeScript strict
npm test                      # Node unit/HTTP/GUI/CLI/registry
npm run test:smoke            # vrai processus daemon + API + mémoire + GUI, fixture synthétique
python -m unittest discover -s tests -v
```

La CI `.github/workflows/runtime-tests.yml` doit exécuter `check`, `test`, `test:smoke` sur Windows et Linux ; archiver les rapports smoke **sans tokens ni chemins utilisateurs**. Les exécutions OpenCode/T3 réelles restent une campagne dédiée, pas un job CI qui consomme une souscription.

### Format de preuve

Pour chaque ID : date UTC, `git SHA`, OS/build, Node/OpenCode/T3 versions, lanceur, `projectId` opaque, source ID non secrète, nom de fixture et digest SHA-256, étapes/commandes, résultat attendu, résultat observé, statut, durées et percentiles, logs assainis, sha256 des artefacts et liens vers CI/replay/screenshot. Utiliser [le modèle de rapport](evidence-template.json).

Un run est `INCONCLUSIVE` si le fournisseur n'expose pas une preuve requise ; **ne pas inventer** un ID enfant, un mécanisme de reload ou une mesure d'amélioration.

### Archive et revue

- Stocker les résultats sous `reports/acceptance/<run-id>/` dans un artefact CI privé ou dans un dossier local hors versionnement.
- Conserver les scripts de fixture synthétiques et le digest de leur état initial.
- Faire revoir les régressions et gates privacy par une seconde personne/un second processus de vérification.
- Avant la release : signer la checklist des gates, archiver preuve de passage Windows/Linux et versionner le rapport de synthèse (sans données sensibles).

## 8. Rapport de sortie

Synthétiser : nombre total PASS/FAIL/BLOCKED/INCONCLUSIVE (séparé par OS/lanceur), écarts à la spec, incidents prioritaires, p95/p99 et taille des données, différences de capacités provider, publications éligibles ou retenues, anomalies sécurité, risques résiduels, décision `GO` ou `NO-GO` **justifiée** et commit testé.

**Interdiction de déclarer GO sur la seule base des tests synthétiques de ce repo.** La première release OpenCode nécessite la matrice native et le protocole d'acceptation documentés ci-dessus.
