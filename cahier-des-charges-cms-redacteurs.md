# Cahier des charges — Application interne de rédaction de recettes
## (CMS Kitchen Menu — nom de code à définir)

**Version :** 1.6
**Date :** Septembre 2026
**Porteur du projet :** Kamel — Kitchen Menu (`app.kingmenu`)
**Statut :** Brouillon de travail, points ouverts non résolus (voir section 12). Roadmap d'automatisation en section 14. Schéma réel confirmé par introspection directe (sections 5.6, 5.6bis, 5.7). **Changements majeurs de cette révision :** (1) `cuisineId` confirmé activement utilisé par l'app — traité comme obligatoire ; (2) modèle calorique = total unique saisi directement sur `dishes.calories` ; (3) `recipe_drafts.difficulty` remplacé par `difficulty_id` (FK), suite à la découverte de dizaines de quasi-doublons dans `cuisine_types` causés par une résolution texte plutôt que par ID — le CMS utilise désormais des listes déroulantes/cases à cocher liées à des ID réels pour `cuisine_type_id` et `difficulty_id`, éliminant ce risque pour les nouvelles recettes ; (4) RLS confirmé en écriture seule via Edge Function/service role sur les tables métier ET sur `storage.objects` (policies CMS ajoutées et vérifiées actives).

---

## 1. Contexte et objectifs

Kitchen Menu (app.kingmenu) est une application mobile de planification de repas, en production sur Google Play (177 pays), avec une base de données Supabase existante.

Aujourd'hui, l'alimentation en recettes est manuelle et non structurée. L'objectif est de créer une **application web interne**, séparée de l'app mobile, permettant :

- à un ou plusieurs **rédacteurs** de saisir des recettes dans un format structuré et contraint ;
- à l'**admin** (Kamel) de valider chaque recette avant publication, de compléter les nouveaux ingrédients détectés, et de déclencher la traduction + l'insertion finale dans la base de production.

**Ce que cette application n'est pas :** ce n'est pas une interface publique, ni un outil de gestion des utilisateurs finaux de Kitchen Menu. Aucun compte ne s'auto-crée — tous les accès sont provisionnés par l'admin.

---

## 2. Périmètre

### Inclus
- Authentification (admin + rédacteurs), sans inscription publique.
- Formulaire de rédaction de recette structuré, avec validation de champs.
- Autocomplétion des ingrédients existants (table `ingredients`).
- Détection et signalement des nouveaux ingrédients.
- Interface admin : validation des recettes, complétion des ingrédients en attente.
- Traduction automatique (fr → en, ar, it, es) au moment de la validation admin, pas avant.
- Insertion finale dans Supabase (`dishes`, `dish_ingredients`, `ingredients`, `cuisine_types`) au moment de la validation.
- Upload d'image par recette.

### Exclu (hors périmètre pour cette V1)
- Gestion des utilisateurs finaux de l'app mobile (table `users`/`profiles`).
- Système de notation réelle par les utilisateurs (une note forfaitaire reste appliquée, voir section 8.6).
- Édition d'une recette déjà publiée depuis cette interface (à évaluer en V2 — voir section 13).
- Gestion multi-admin avec droits différenciés (un seul niveau admin en V1).
- **Toute automatisation de la production de contenu** (génération de recettes par IA, import en masse depuis un CSV ou une API tierce, scraping de sites de recettes). Le CMS rédacteurs + validation admin reste le seul canal d'alimentation de la base en V1. Ces trois axes sont documentés en section 14 comme pistes différées, chacun avec ses contraintes propres de coût, de risque légal ou de fiabilité — aucun n'est prêt à être développé sans arbitrage préalable.

---

## 3. Utilisateurs et rôles

| Rôle | Création de compte | Droits |
|---|---|---|
| **Admin** | Compte initial créé manuellement en base | Crée/désactive les comptes rédacteurs, valide/rejette les recettes, complète les ingrédients en attente, gère la liste des types de cuisine et des unités de mesure |
| **Rédacteur** | Créé par l'admin uniquement (identifiant + mot de passe transmis manuellement) | Rédige des recettes, consulte le statut de ses propres soumissions, ne voit pas les recettes des autres rédacteurs (à confirmer si plusieurs rédacteurs prévus dès la V1) |

**Recommandation :** ne pas mélanger ces comptes avec la table `auth.users` / `profiles` de Kitchen Menu. Créer un espace d'authentification Supabase logiquement séparé (même projet Supabase, mais table dédiée `cms_users` avec un rôle, RLS strictes). Éviter qu'un bug de droits dans le CMS n'expose des données utilisateur de l'app mobile, ou inversement.

**Confirmé : 3 rédacteurs dès la V1.** Chaque rédacteur ne voit et ne modifie que ses propres brouillons (`recipe_drafts`) — l'admin a une visibilité totale. L'isolation par RLS n'est donc pas une option différée à la V2, elle doit être en place dès le développement initial.

---

## 4. Architecture technique proposée

- **Frontend :** React/Vite — cohérent avec la stack déjà utilisée sur Kitchen Menu, pas de nouvel outil à apprendre.
- **Hébergement frontend :** GitHub Pages (gratuit, cohérent avec le déploiement existant) ou Vercel free tier. Cette application n'a pas besoin de Capacitor (pas de version mobile native prévue).
- **Backend / logique serveur :** Supabase Edge Functions. Nécessaire pour :
  - ne jamais exposer la clé API DeepL côté client (obligatoire — une clé visible dans le bundle JS est une clé compromise) ;
  - exécuter la logique d'insertion finale (traduction, contrôle des contraintes, insertion) côté serveur, pas côté navigateur du rédacteur.
- **Base de données :** le même projet Supabase que Kitchen Menu (`vehqvqlbtotljstixklz`), avec des tables additionnelles dédiées au CMS (section 7).
- **Dépôt GitHub :** nouveau dépôt séparé, comme prévu (`kamel73-web/kitchen-menu-cms` ou nom équivalent).
- **Coût :** Supabase Edge Functions gratuites jusqu'à un quota mensuel généreux, GitHub Pages gratuit. Le seul poste de coût potentiel reste l'API de traduction (DeepL) — à vérifier lors de l'inscription (voir échange précédent, conditions actuelles ambiguës selon les sources).

---

## 5. Nouvelles tables Supabase requises

Ces tables n'existent pas dans le schéma actuel et doivent être créées avant tout développement.

### 5.1 `cms_users`
Comptes des rédacteurs et de l'admin, séparés des utilisateurs finaux.
- `id` (uuid, référence `auth.users`)
- `role` (`admin` | `redacteur`)
- `display_name` (text)
- `is_active` (boolean, default true) — pour désactiver un accès sans supprimer l'historique
- `created_at`

### 5.2 `recipe_drafts`
Table de brouillon — **aucune recette n'entre dans `dishes` avant validation admin.**
- `id` (uuid)
- `writer_id` (référence `cms_users`)
- `status` (`brouillon` | `soumis` | `approuve` | `rejete`)
- `name_fr`, `description_fr`, `steps_fr` (jsonb, tableau d'étapes)
- `cooking_time`, `servings`, `cuisine_type_id` (référence `cuisine_types.id`), `difficulty_id` (référence `difficulties.id`) — les deux sont des ID choisis directement dans le formulaire (liste déroulante pour la cuisine, cases à cocher pour la difficulté), jamais du texte libre à faire correspondre a posteriori.
- `calories` (integer, nullable) — total en kcal pour le plat entier, saisi directement, jamais calculé. Correspond exactement à `dishes.calories` (integer), colonne déjà existante — voir schéma réel confirmé en 5.6. Optionnel à la saisie rédacteur (voir 6.2), complété par l'admin si absent (voir 7.3).
- `tags_fr` (jsonb, tableau de chaînes)
- `image_url` (text)
- `ingredients` (jsonb — liste d'objets `{ingredient_id ou nom_temporaire, quantite, unite}`) — pas de champ calories ici : `dish_ingredients` n'a pas de colonne calories dans le schéma réel (confirmé 5.6), donc aucune valeur calorique ne doit être stockée par ligne d'ingrédient.
- `admin_notes` (text, nullable) — motif de rejet le cas échéant
- `dish_id` (référence `dishes`, rempli seulement après publication effective)
- `created_at`, `submitted_at`, `reviewed_at`

### 5.3 `ingredient_requests` (ou colonne `status` ajoutée à `ingredients`)
Recommandation : ajouter directement à `ingredients` plutôt que créer une table séparée, plus simple à interroger.
```sql
ALTER TABLE public.ingredients
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active')),
  ADD COLUMN requested_by uuid REFERENCES public.cms_users(id);
```
Un ingrédient créé par un rédacteur via l'autocomplétion (nom non trouvé) est inséré avec `status = 'pending'`, sans catégorie/image. Il n'apparaît pas dans les résultats d'autocomplétion normaux tant qu'il n'est pas `active`. (Les calories ne sont pas un attribut de l'ingrédient — voir 5.2, 5.5, 5.6 — donc elles ne font pas partie de ce qui manque ici.)

### 5.4 `measurement_units`
Actuellement, l'unité de mesure est un texte libre dans `dish_ingredients.unit` (jsonb). Une liste contrôlée reste recommandée plutôt que du texte libre, pour la cohérence d'affichage et l'autocomplétion des unités en saisie :
- `id`
- `label` (jsonb : fr/en/ar/it/es)
- `grams_equivalent` (numeric, nullable — ex: 1g pour "g", 1000g pour "kg", null pour "pièce(s)" si non convertible sans info produit)

Liste de départ suggérée : g, kg, ml, cl, l, pièce(s), cuillère à soupe, cuillère à café, pincée, tranche(s). Extensible uniquement par l'admin, pas par les rédacteurs — évite la prolifération d'unités incohérentes.

**Point à trancher — `grams_equivalent` est-il encore utile ?** Sa seule justification documentée jusqu'ici était le calcul calorique (conversion quantité → grammes → calories). Ce calcul n'existe plus : les calories sont désormais un total unique saisi directement au niveau du plat (voir 5.2, 5.6, 6.2, 8), sans passer par une conversion en grammes par ingrédient. À moins qu'il serve à autre chose (ex : agrégation d'une liste de courses en unités cohérentes — non spécifié dans ce document), ce champ n'a pas d'usage réel identifié dans le code actuel (contrairement à `dishes.cuisineId`, dont l'usage a été vérifié — voir section 12, point 7). **À vérifier avant de l'inclure dans la migration**, plutôt que de le développer par habitude.

### 5.5 Colonnes déjà actées précédemment (rappel)
- `difficulties.label` complété en ar/it/es (migration déjà rédigée).
- ~~`ingredients.calories_per_100g`, `ingredients.grams_per_unit`~~ — **retiré.** Confirmé absent du schéma réel (5.6). Cette migration ne doit pas être exécutée.

### 5.6 Schéma réel confirmé par introspection (`information_schema.columns`, septembre 2026)
Cette section fait foi sur toute description antérieure dans ce document qui la contredirait. Colonnes existantes uniquement — les tables/colonnes proposées ailleurs (`cms_users`, `recipe_drafts`, `measurement_units`, `ingredients.status`) n'existent pas encore et ne sont pas listées ici.

- **`dishes`** : `id` (integer), `name` (jsonb), `description` (jsonb), `steps` (jsonb), `cooking_time` (integer), `cuisine_type` (jsonb), `image_url` (text), `rating` (numeric), **`calories` (integer, nullable) — un seul total par plat**, `servings` (integer), `tags` (jsonb), `cuisineId` (integer, nullable), `difficulty` (jsonb), `difficultyId` (integer, nullable), `search_vector` (tsvector), `updated_at` (timestamp with time zone, NOT NULL), `is_premium` (boolean, NOT NULL).
- **`dish_ingredients`** : `id` (bigint), `dish_id` (integer), `ingredient_id` (integer), `quantity` (double precision, nullable), `unit` (jsonb, nullable). **Aucune colonne calories.**
- **`ingredients`** : `id` (integer), `name` (jsonb), `category` (jsonb, nullable), `image_url` (text, nullable), `min_quantity` (double precision, nullable), `no_measure` (boolean, nullable). **Aucune colonne calories_per_100g, grams_per_unit, ni status/requested_by** — ces derniers sont une proposition de migration (5.3), pas l'existant.
- **`cuisine_types`** : `id` (integer), `name` (jsonb), `created_at` (timestamp without time zone, nullable).
- **`difficulties`** : `id` (integer), `label` (jsonb).

Autres tables existantes vues dans le dump complet (septembre 2026), sans lien direct avec ce CMS mais pour mémoire : `users`, `profiles`, `user_preferences` (trois tables distinctes qui portent chacune une partie des préférences utilisateur — hors périmètre de ce document, mais à garder en tête si un jour le CMS doit lire les préférences pour, par exemple, prévisualiser des recommandations), `subscriptions`, `family_groups`, `family_members`, `shopping_lists`, `saved_dishes`, `meal_plans`, `user_available_ingredients`, `deletion_requests`, `schema_versions`, `spatial_ref_sys` (PostGIS, non utilisée par le CMS). Une table `ingredients_backup` existe également (colonnes `id`, `name`, `category`, `image_url`, pas de contrainte primaire listée) — probablement une sauvegarde manuelle ponctuelle, sans rapport avec ce cahier des charges.

### 5.6bis Contraintes et triggers réels sur `dishes` (DDL confirmé, septembre 2026)
- **`dishes.difficulty` (jsonb) a un CHECK constraint** : `difficulty->>'en'` doit être dans `('Easy','Medium','Hard')` **et** `difficulty->>'fr'` doit être dans `('Facile','Moyen','Difficile')`. Le constraint ne vérifie pas que les deux valeurs correspondent au même niveau réel (ex : `{en:"Easy", fr:"Difficile"}` passerait le CHECK) — c'est au processus d'insertion de garantir la cohérence, pas à la base. En copiant `difficulties.label` tel quel (voir 8.4), cette cohérence est automatiquement respectée puisque c'est la source canonique.
- **`dishes.cuisineId` et `dishes.difficultyId` n'ont aucune contrainte FK déclarée** dans le DDL (simples `integer null`) — la référence vers `cuisine_types`/`difficulties` est une convention de nommage, pas une contrainte de base appliquée. Le CMS doit donc lui-même garantir la cohérence (voir 8.4), la base ne le fera pas à sa place.
- **Index unique `dishes_name_en_unique` sur `(name->>'en')`** : deux plats ne peuvent pas avoir la même traduction anglaise. Confirme la règle déjà documentée en 8, étape 3 (vérification anti-doublon).
- **`updated_at` a un défaut figé** : `'2026-01-18 00:00:00+00'::timestamptz` — pas `now()`. Confirme ce qui était déjà noté en section 8, étape 5 (contournement nécessaire, fixer la valeur explicitement à l'insertion).
- **Trigger `trig_dishes_search_vector`** (`BEFORE INSERT OR UPDATE`) : calcule automatiquement `search_vector` à partir de `name`, `description` et `cuisine_type` (toutes langues confondues, pondération A/B/C). **Le CMS n'a rien à faire pour `search_vector`** — c'est entièrement automatique tant que `name`/`description`/`cuisine_type` sont correctement remplis avant l'insertion.
- **Trigger `dishes_sync_cuisine_type`** (`AFTER INSERT OR UPDATE OF cuisine_type`) : corps de fonction confirmé — insère `NEW.cuisine_type` dans `cuisine_types` si absent (`ON CONFLICT ((name::text)) DO NOTHING`, index `unique_cuisine_name_text` confirmé existant). Ne renseigne jamais `cuisineId` (trigger `AFTER`, sans effet sur la ligne déjà insérée). Détail complet de l'usage en 8.4.

### 5.7 RLS confirmé sur les tables existantes (dump de policies, septembre 2026)
Ce point valide une hypothèse du document plutôt que de la contredire, mais il vaut mieux l'écrire noir sur blanc puisqu'elle conditionne toute l'architecture d'insertion (section 8) :

**`dishes`, `ingredients`, `dish_ingredients`, `cuisine_types`, `difficulties` n'ont que des policies `SELECT`** (pour `authenticated` et/ou `public`/`anon` selon la table). **Aucune policy `INSERT`/`UPDATE`/`DELETE` n'existe sur ces tables**, quel que soit le rôle. Concrètement :
- Un appel authentifié classique (clé anon + session utilisateur) ne peut **jamais** écrire dans `dishes`, `ingredients` ou `dish_ingredients` — RLS bloque silencieusement toute tentative (retour vide ou erreur de policy, pas une erreur de schéma).
- Cela confirme que l'approche déjà retenue dans ce document — écriture uniquement via Edge Function avec `SUPABASE_SERVICE_ROLE_KEY` (qui contourne RLS), voir section 10 — n'est pas une option parmi d'autres mais **la seule voie d'écriture possible** avec la configuration RLS actuelle. Point confirmé, pas supposé.
- Corollaire pour la roadmap V2/V3 (section 14) : si un jour l'admin veut un accès en écriture côté client (ex : un mini formulaire admin sans passer par une Edge Function), il faudra explicitement ajouter des policies `INSERT`/`UPDATE` restreintes à un rôle admin — ce n'est pas prévu aujourd'hui et ne doit pas être supposé disponible.
- Les futures tables du CMS (`cms_users`, `recipe_drafts`) n'existent pas encore et n'ont donc aucune policy : elles seront RLS "deny all" par défaut dès leur création tant que les policies décrites en section 10 ne sont pas explicitement écrites. Ne pas supposer un comportement permissif par défaut.

**Confirmé par requête directe sur `pg_proc`** (pas juste rapporté en conversation) : le contenu exact du trigger `sync_cuisine_type()` correspond à ce qui est décrit en 5.6bis et 8.4.

**Storage (`storage.objects`, bucket `dish-images`) — confirmé séparément** : bucket `public = true`, sans limite de taille ni restriction MIME. Seules des policies `SELECT` existaient à l'origine (dont une policy cassée, `bucket_id = 'dish_images'` avec un underscore inexistant — sans impact puisque le bucket est public au niveau bucket, donc servi via URL directe sans passer par ces policies). Policies `INSERT`/`UPDATE`/`DELETE` ajoutées et confirmées actives, scopées aux `cms_users` actifs (voir section 9).

**`recipe_drafts.difficulty`** a été remplacé par **`difficulty_id`** (FK vers `difficulties.id`) — migration exécutée et confirmée (colonne `difficulty` absente, `difficulty_id integer` présente). Voir 8.4 pour la justification (éviter la même fragilité de résolution texte que celle constatée sur `cuisineId`).

---

## 6. Parcours rédacteur

### 6.1 Connexion
Identifiant + mot de passe fournis par l'admin. Pas de "mot de passe oublié" en libre-service en V1 (l'admin réinitialise manuellement) — à reconsidérer si le nombre de rédacteurs grandit.

### 6.2 Création d'une recette — formulaire structuré

| Champ | Obligatoire | Type de saisie | Règle |
|---|---|---|---|
| Titre | Oui | Texte libre (fr) | — |
| Description | Non | Texte libre (fr) | — |
| Étapes de préparation | Oui, min. 1 | Liste dynamique — bouton "Ajouter une étape" | Chaque étape est un bloc de texte distinct (correspond au tableau `steps_fr`) |
| Type de cuisine | Oui | Liste déroulante, alimentée depuis `cuisine_types` | Lecture seule pour le rédacteur — pas de création à la volée (à confirmer, voir 12) |
| Difficulté | Oui | Boutons radio : Facile / Moyen / Difficile | Correspond à `DIFFICULTY_TRANSLATIONS` déjà définies |
| Durée de cuisson | Oui | Nombre (minutes) | — |
| Nombre de personnes | Oui | Nombre entier | — |
| Calories | Non | Nombre entier (kcal) | Total pour le plat entier, saisi directement (estimation du rédacteur) — pas de calcul automatique. Si vide, l'admin le complète avant validation (voir 7.3) |
| Ingrédients | Oui, min. 1 | Voir 6.3 | — |
| Tags | Non | Saisie libre avec ajout par validation (Entrée) | Chaque tag traduit individuellement à la validation admin |
| Photo | Oui | Upload direct (drag & drop ou sélection fichier) | Stockage dans le bucket Supabase `dish-images` |

### 6.3 Saisie des ingrédients — autocomplétion

Pour chaque ligne d'ingrédient :
1. Le rédacteur tape un nom.
2. Une recherche en temps réel interroge `ingredients` (nom fr, `status = 'active'` uniquement) et propose des suggestions.
3. Si le rédacteur sélectionne une suggestion → l'ingrédient existant est lié (`ingredient_id`).
4. Si aucune suggestion ne correspond et que le rédacteur valide un nom non reconnu → un nouvel ingrédient est créé côté base avec `status = 'pending'`. Le rédacteur renseigne uniquement le nom ; catégorie et image restent à la charge de l'admin (voir 7.2).
5. Pour chaque ingrédient (existant ou nouveau) : quantité (nombre) + unité (liste déroulante depuis `measurement_units`). Pas de champ calories ici — les calories sont saisies une seule fois, pour le plat entier (voir 6.2).

### 6.4 Soumission
Le rédacteur soumet la recette → `recipe_drafts.status = 'soumis'`. Aucune insertion dans `dishes` à ce stade. Le rédacteur voit le statut de ses propres soumissions uniquement — pas celles des deux autres rédacteurs (3 rédacteurs prévus dès la V1, isolation requise, voir section 3 et 10).

---

## 7. Parcours admin

### 7.1 Tableau de bord
Deux listes principales :
- **Recettes en attente de validation** (`recipe_drafts.status = 'soumis'`)
- **Ingrédients en attente de complétion** (`ingredients.status = 'pending'`)

### 7.2 Complétion des ingrédients en attente
Pour chaque ingrédient signalé, l'admin renseigne :
- Catégorie (fr — traduite ensuite automatiquement, comme pour les recettes)
- Image (optionnelle)
- Quantité minimale pour liste de courses (`min_quantity`)
- `no_measure` (bascule vrai/faux)

Une fois complété, `status` passe à `active` — l'ingrédient devient disponible en autocomplétion pour tous les rédacteurs, et toute recette en attente qui l'utilisait devient éligible à validation.

**Règle bloquante (ingrédients) :** une recette contenant au moins un ingrédient encore `pending` ne peut pas être approuvée. L'interface doit le signaler clairement à l'admin (ex : bandeau "1 ingrédient à compléter avant validation").

### 7.3 Aperçu et validation d'une recette
L'admin visualise la recette telle qu'elle apparaîtra dans l'app (rendu de l'aperçu, pas juste les champs bruts), y compris le total calorique du plat. S'il n'a pas été renseigné par le rédacteur, l'admin le complète directement dans cet écran avant de pouvoir approuver.

**Règle bloquante (calories) :** une recette sans total calorique renseigné ne peut pas être approuvée. Distincte de la règle bloquante sur les ingrédients `pending` (7.2).

Deux actions possibles :
- **Rejeter** → statut `rejete`, motif texte transmis au rédacteur, recette modifiable à nouveau par le rédacteur.
- **Approuver** → déclenche la chaîne de traitement finale (section 8).

---

## 8. Traitement à la validation (déclenché par l'admin, exécuté en Edge Function)

1. **Vérification pré-insertion** : tous les ingrédients de la recette sont `active` (sinon blocage, retour à 7.2).
2. **Traduction** (DeepL, appel serveur avec clé secrète) : titre, description, étapes, tags, type de cuisine (si nouveau).
3. **Vérification anti-doublon sur `name->>'en'`** (contrainte unique existante) : si la traduction anglaise entre en collision avec un plat existant, l'insertion est bloquée et remontée à l'admin avec un message explicite — pas une erreur SQL brute.
4. **`cuisine_type_id` et `difficulty_id` : pas de résolution à faire, ils sont déjà des ID valides.**
   Contrairement à ce qui était envisagé initialement (recherche/traduction à la volée), le rédacteur choisit directement une valeur existante — liste déroulante pour le type de cuisine, cases à cocher pour la difficulté (une seule sélectionnable). `recipe_drafts.cuisine_type_id` et `recipe_drafts.difficulty_id` sont donc déjà des FK valides vers `cuisine_types`/`difficulties` au moment de la validation admin. **Le CMS ne permet pas de créer un nouveau type de cuisine ou une nouvelle difficulté** — ce sont des listes fermées, gérées uniquement par l'admin directement en base si besoin (hors CMS). Si ça doit changer, c'est une décision à prendre explicitement, pas un oubli.

   L'Edge Function se contente de :
   - `SELECT name FROM cuisine_types WHERE id = recipe_drafts.cuisine_type_id` → copié tel quel dans `dishes.cuisine_type` (jsonb), et `dishes.cuisineId = cuisine_type_id`.
   - `SELECT label FROM difficulties WHERE id = recipe_drafts.difficulty_id` → copié tel quel dans `dishes.difficulty` (jsonb), et `dishes.difficultyId = difficulty_id`. Comme ce label provient directement de `difficulties` (source canonique du CHECK constraint sur `dishes.difficulty`, voir 5.6bis), la contrainte est automatiquement respectée — pas de risque de valeur invalide.

   **Ce que ça évite, confirmé par une vraie donnée de production plutôt que par précaution théorique :** `cuisine_types` contient aujourd'hui des dizaines de quasi-doublons accumulés par le passé — par exemple 6 lignes distinctes pour "French" (`fr` : "Française", "Français", "Française (régionale)", "Française (moderne)", etc.), parce qu'une résolution par correspondance texte a créé une nouvelle ligne à chaque variation de formulation plutôt que de réutiliser l'existant. Le trigger `sync_cuisine_type()` ne peut pas détecter ces doublons : il déduplique sur le texte complet de l'objet jsonb (`ON CONFLICT ((name::text))`, index confirmé existant), pas sur le sens. En forçant la sélection depuis une liste fermée, le CMS ne peut pas reproduire ce problème pour les nouvelles recettes — mais ne corrige pas non plus les doublons déjà présents (hors périmètre de ce document, voir section 12 si un nettoyage est un jour nécessaire).

   **Règle bloquante, révisée :** un brouillon sans `cuisine_type_id` ou sans `difficulty_id` renseigné ne peut pas être soumis par le rédacteur (validation de formulaire côté client, section 6.2) — pas une règle à vérifier côté admin, puisque ce sont des champs obligatoires du formulaire, pas des champs optionnels à compléter après coup comme les calories.
5. **Insertion dans `dishes`** : `is_premium = false` par défaut, `rating = 4.5` (forfaitaire, voir 8.6), `calories` inséré directement depuis la valeur saisie en 6.2 ou complétée en 7.3 (jamais nulle à ce stade grâce à la règle bloquante de 7.3 — **pas de calcul, insertion directe de la valeur saisie**), `updated_at` fixé explicitement à la date de traitement (le défaut de colonne est figé sur une date fixe, contournement nécessaire tant que non corrigé en base).
6. **Insertion dans `dish_ingredients`** pour chaque ligne d'ingrédient (`dish_id`, `ingredient_id`, `quantity`, `unit`) — conforme au schéma réel (5.6), qui ne comporte pas de colonne calories sur cette table.
7. **Mise à jour de `recipe_drafts`** : `status = 'approuve'`, `dish_id` renseigné, `reviewed_at` horodaté.

### 8.6 Note forfaitaire (rappel du point soulevé précédemment)
`rating = 4.5` reste appliqué automatiquement à toute recette publiée, en l'absence de système d'avis réel. Ce point reste un choix produit à assumer, pas un défaut technique.

### 8.7 Conséquence du modèle calorique retenu
Le total calorique est une **estimation saisie à la main** (par le rédacteur ou l'admin), pas un calcul dérivé des ingrédients. Implication à assumer consciemment : rien dans ce document ne garantit que la valeur saisie est juste — pas de recoupement automatique avec la liste d'ingrédients ou les quantités. Si l'admin doit un jour vérifier la plausibilité d'un total (ex : 50 kcal pour un plat de pâtes carbonara), ce sera une vérification humaine au moment de la validation (7.3), pas un contrôle du système.

---

## 9. Gestion des images

- Upload direct depuis le formulaire rédacteur (pas de recherche externe automatisée, décision actée dans les échanges précédents).
- Stockage : bucket Supabase Storage `dish-images` (public).
- Contraintes à définir : poids maximal, formats acceptés (jpg/png/webp), redimensionnement éventuel côté client avant upload pour limiter la consommation de stockage (rappel : palier gratuit Supabase à 500 Mo, déjà identifié comme risque dans le contexte du projet).

---

## 10. Sécurité

- Clé `SUPABASE_SERVICE_ROLE_KEY` et clé DeepL : jamais côté client, uniquement dans les Edge Functions.
- RLS sur `recipe_drafts` : un rédacteur ne peut lire/modifier que ses propres brouillons ; l'admin a accès à tout.
- RLS sur `cms_users` : lecture restreinte à l'utilisateur lui-même et à l'admin.
- Aucune création de compte en libre-service — surface d'attaque réduite volontairement.

---

## 11. Non-fonctionnel

- **Coût :** doit rester à 0€ tant que Kitchen Menu n'est pas en Phase Société — seul point de vigilance réel : les conditions exactes de l'offre gratuite DeepL (à vérifier avant intégration, cf. échange précédent).
- **Charge :** conçu pour un usage à faible fréquence (quelques rédacteurs, pas de trafic public), donc les quotas gratuits (Supabase Edge Functions, Storage, DeepL) ne devraient pas être un facteur limitant à ce stade.
- **Disponibilité :** aucune exigence de haute disponibilité — outil interne, pas de SLA.

---

## 12. Points ouverts — bloquants pour le développement

1. ~~Contenu de la fonction `sync_cuisine_type()`~~ — **Résolu.** Le trigger s'exécute en `AFTER INSERT OR UPDATE OF cuisine_type` et déduplique `cuisine_types` sur le texte complet de l'objet jsonb (`ON CONFLICT ((name::text))`). Il ne renseigne jamais `cuisineId` — ce champ doit être résolu côté application avant l'insertion. Détail complet en section 8.4.
2. ~~Format réel d'un plat existant~~ — **Résolu, avec réserve.** `name` et `cuisine_type` : confirmés comme objets jsonb à 5 clés (ar/en/es/fr/it), cohérents avec le design du CMS. `tags` : vide sur les échantillons observés, aucune contrainte héritée. **`steps` : incohérent entre plats existants** — certains stockent un tableau de chaînes par langue (format retenu pour le CMS), d'autres stockent une chaîne unique par langue avec la numérotation intégrée au texte. Le code d'affichage mobile doit déjà composer avec les deux formats. Le CMS produira exclusivement le format tableau ; l'uniformisation des anciens plats reste un chantier séparé, hors périmètre de ce projet.
3. ~~Existence d'un index unique sur `cuisine_types (name::text)`~~ — **Résolu.** Confirmé par l'exécution réussie d'un `INSERT ... ON CONFLICT ((name::text)) DO NOTHING` sur `cuisine_types` sans erreur de contrainte manquante.
4. ~~Le rédacteur peut-il proposer un nouveau type de cuisine ?~~ — **Résolu. Non.** Liste en lecture seule, alimentée uniquement par `cuisine_types`. Cohérent avec la section 6.2.
5. ~~Combien de rédacteurs sont prévus dès la V1 ?~~ — **Résolu. Trois rédacteurs.** L'isolation des données par rédacteur (RLS sur `recipe_drafts`, section 10) est donc une exigence réelle de la V1, pas une option différée — impact direct sur l'effort de développement, voir section 3 et 10 mises à jour.
6. **Conditions réelles de l'offre gratuite DeepL** au moment de l'implémentation (carte bancaire, volume) — à vérifier directement sur le site avant de démarrer l'intégration.
7. ~~Usage réel de `dishes.cuisineId` dans le code de l'app mobile~~ — **Résolu. Utilisé activement, pas un champ mort.** Confirmé dans `src/components/Home/DishGrid.tsx` : `cuisineId` sert au filtre par type de cuisine (`matchesCuisine`) **et** au matching des préférences utilisateur pour les recommandations (`matchesPreferences`). Le code contient même un mécanisme de repli (résolution par correspondance texte sur `dish.cuisine` si `cuisineId` est vide) — signe que le champ est censé être fiable en usage normal, ce repli n'étant qu'un filet de sécurité. **Conséquence directe pour le CMS : `cuisineId` doit être traité comme un champ obligatoire à l'insertion (étape 8.4), pas optionnel ou secondaire.** Une recette insérée sans `cuisineId` résolu correctement cassera silencieusement le filtre par cuisine et les recommandations personnalisées pour ce plat — aucune erreur visible, juste un plat qui n'apparaît jamais dans les bons filtres.

---

## 13. Phasage recommandé

**MVP (V1) — le strict nécessaire pour remplacer la saisie manuelle actuelle :**
- Authentification admin + un seul rédacteur.
- Formulaire de rédaction complet (section 6).
- Autocomplétion ingrédients + signalement des nouveaux.
- Validation admin simple (approuver/rejeter, sans aperçu visuel poussé — juste un rendu texte structuré).
- Traduction et insertion automatiques à la validation.

**V2 (à ne considérer qu'une fois le MVP en usage réel) :**
- Aperçu visuel fidèle au rendu app mobile.
- Gestion de plusieurs rédacteurs avec suivi individualisé.
- Édition d'une recette déjà publiée depuis l'interface.
- Historique des modifications / versioning des recettes.
- Notifications (email) à l'admin pour les nouvelles soumissions.
- Import CSV en masse (voir 14.1) — le seul des trois axes d'automatisation compatible avec la contrainte coût zéro.

**V3 (conditionné à la Phase Société — budget disponible, voir section 14) :**
- Génération de recettes par IA (14.2).
- Import via API tierce ou scraping (14.3).

Le MVP seul représente déjà plusieurs semaines de développement solo (auth, CRUD structuré, autocomplétion, Edge Functions, traduction, upload) — le phasage n'est pas une option de confort, c'est ce qui rend le projet réalisable en solo à côté de Kitchen Menu.

---

## 14. Roadmap — automatisation future de l'alimentation de la base

Cette section documente les trois pistes évoquées pour automatiser l'alimentation de `dishes`, au-delà du CMS rédacteurs. **Aucune des trois n'est développée en V1.** Elles sont classées ici par ordre de compatibilité avec la contrainte coût zéro (section 11) et le principe de garde-fou qualité (validation admin, section 7).

### 14.1 Import CSV (candidat V2)
- **Principe :** l'admin (ou un rédacteur habilité) dépose un fichier CSV contenant une ou plusieurs recettes déjà rédigées ailleurs (notes personnelles, tableur existant).
- **Flux :** chaque ligne du CSV crée une entrée dans `recipe_drafts` avec `status = 'soumis'` — elle passe par le même circuit de validation admin que les recettes saisies via le formulaire (section 7 et 8). Aucun contournement du contrôle qualité.
- **Coût :** nul. Pas d'appel API externe, pas de dépendance tierce.
- **Risque légal :** nul si le contenu du CSV appartient à l'admin ou a été rédigé par lui — à vérifier au cas par cas si la source est externe.
- **Effort de développement :** modéré — un parseur CSV avec mapping de colonnes vers les champs de `recipe_drafts`, une validation de format avant insertion, et une gestion d'erreurs ligne par ligne (ex : ligne mal formée → rapport d'erreur, pas de blocage total de l'import).
- **Prérequis avant développement :** définir le format de colonnes attendu (un gabarit CSV à fournir aux rédacteurs), et décider si les ingrédients référencés par nom déclenchent la même logique `pending`/`active` que le formulaire (recommandé, pour rester cohérent avec 6.3).

### 14.2 Génération de recettes par IA (différé, hors V1/V2)
- **Principe :** appel à une API de génération de texte (Claude API, GPT, etc.) pour produire des recettes à partir d'une consigne (type de cuisine, contraintes nutritionnelles, etc.).
- **Coût :** facturé à l'usage (par token), incompatible avec la contrainte "coût zéro tant que Kitchen Menu n'est pas en Phase Société" (section 11). Pas de palier gratuit exploitable à un volume de production réel.
- **Risque qualité :** une recette générée peut contenir des erreurs de sécurité alimentaire (températures, temps de cuisson, associations d'ingrédients) qui ne sont pas de simples fautes de frappe — elles nécessitent une revue humaine compétente, pas juste une validation de format. Le rôle de l'admin devient donc plus lourd, pas plus léger.
- **Conclusion :** à ne considérer qu'une fois un budget dédié existe, avec un processus de validation renforcé (pas le même niveau de contrôle que pour une recette rédigée par un humain de confiance).

### 14.3 Import externe — API tierce ou scraping (différé, hors V1/V2)
- **Principe :** récupérer des recettes depuis une source externe (API de recettes payante type Spoonacular/Edamam, ou extraction automatisée de sites publics).
- **Coût (API tierce) :** quota gratuit généralement faible ; au-delà, facturation récurrente — incompatible avec la contrainte coût zéro tant que le seuil Phase Société n'est pas atteint.
- **Risque légal (scraping) :** le contenu de recettes tiers est en général protégé (droits d'auteur sur le texte, parfois sur les photos) et l'extraction automatisée peut violer les conditions d'utilisation des sites sources. C'est un risque juridique direct pour le porteur du projet, pas un simple point technique à arbitrer plus tard.
- **Conclusion :** nécessite un avis juridique ou un choix de source explicitement libre de droits avant tout développement. Ne pas démarrer sans cette vérification, quel que soit l'intérêt technique.

### 14.4 Principe commun aux trois axes
Quel que soit l'axe retenu à terme, **aucun ne doit contourner la validation admin** (section 7). Le filtre qualité humain est particulièrement nécessaire pour du contenu généré ou importé automatiquement — c'est l'inverse d'un candidat à l'automatisation.
