# Kitchen Menu — CMS rédacteurs

Interface d'administration pour la rédaction et la validation des recettes de Kitchen Menu.
Voir le cahier des charges complet (`cahier-des-charges-cms-redacteurs.md`) pour la spécification fonctionnelle détaillée.

## Mise en route (Codespace)

1. Copier ces fichiers dans le repo `RECETTES` (racine du repo).
2. Créer `.env` à partir de `.env.example` et renseigner `VITE_SUPABASE_ANON_KEY` (clé anon, jamais la service role key).
3. `npm install`
4. `npm run dev` pour tester en local dans le Codespace.

## Déploiement

Automatique via GitHub Actions à chaque push sur `main` (`.github/workflows/deploy.yml`), vers GitHub Pages.

**Avant le premier déploiement**, ajouter dans Settings → Secrets and variables → Actions du repo `RECETTES` :
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Et activer GitHub Pages (Settings → Pages → Source : GitHub Actions).

## Prérequis base de données

La migration `supabase_migration_cms.sql` (tables `cms_users`, `recipe_drafts`, colonnes `ingredients.status`/`requested_by`)
doit être exécutée avant toute utilisation. Voir cahier des charges section 5.

## État actuel

- [x] Authentification (Supabase Auth + vérification `cms_users`, rôle admin/rédacteur, `is_active`)
- [x] Route protégée + déconnexion
- [ ] Formulaire de rédaction de recette (section 6 du cahier des charges)
- [ ] Autocomplétion ingrédients
- [ ] Écran de validation admin (section 7)
- [ ] Edge Function de traitement à l'approbation (section 8)
