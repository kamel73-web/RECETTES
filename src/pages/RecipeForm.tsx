```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type {
  CuisineType,
  Difficulty,
  MeasurementUnit,
  IngredientOption,
  DraftIngredientLine,
} from '@/lib/types';

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px',
  marginTop: 4,
  marginBottom: 16,
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = { fontWeight: 600 };

const sectionStyle: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 16,
  marginBottom: 20,
};

/**
 * Normalise un texte pour les recherches d'ingrédients.
 *
 * Exemples :
 *   Œuf      -> oeuf
 *   OEUF     -> oeuf
 *   oeuf     -> oeuf
 *   Échalote -> echalote
 *   Æble     -> aeble
 *
 * On traite explicitement les ligatures Œ/œ et Æ/æ car
 * la décomposition Unicode standard ne suffit pas toujours
 * pour ces caractères.
 */
function normalizeIngredientName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/Œ/g, 'OE')
    .replace(/œ/g, 'oe')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export default function RecipeForm() {
  const { cmsUser } = useAuth();
  const navigate = useNavigate();

  // Listes de référence (lecture seule, chargées une fois)
  const [cuisineTypes, setCuisineTypes] = useState<CuisineType[]>([]);
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [units, setUnits] = useState<MeasurementUnit[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  // Tous les ingrédients actifs, chargés une fois pour permettre
  // une recherche Unicode fiable (Œ = OE, accents, casse, etc.).
  const [activeIngredients, setActiveIngredients] = useState<IngredientOption[]>([]);

  // Champs du formulaire
  const [nameFr, setNameFr] = useState('');
  const [descriptionFr, setDescriptionFr] = useState('');
  const [steps, setSteps] = useState<string[]>(['']);
  const [cuisineTypeId, setCuisineTypeId] = useState<number | ''>('');
  const [difficultyId, setDifficultyId] = useState<number | ''>('');
  const [cookingTime, setCookingTime] = useState<number | ''>('');
  const [servings, setServings] = useState<number | ''>('');
  const [calories, setCalories] = useState<number | ''>('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [ingredientLines, setIngredientLines] = useState<DraftIngredientLine[]>([]);
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [ingredientResults, setIngredientResults] = useState<IngredientOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  // Chargement des listes de référence et des ingrédients actifs au montage
  useEffect(() => {
    async function loadRefs() {
      const [cuisineRes, difficultyRes, unitRes, ingredientsRes] = await Promise.all([
        supabase.from('cuisine_types').select('id, name').order('id'),
        supabase.from('difficulties').select('id, label').order('id'),
        supabase.from('measurement_units').select('id, label, grams_equivalent').order('id'),
        supabase
          .from('ingredients')
          .select('id, name, status')
          .eq('status', 'active')
          .order('id'),
      ]);

      if (cuisineRes.error || difficultyRes.error || unitRes.error || ingredientsRes.error) {
        setFormError(
          'Erreur au chargement des listes de référence ou des ingrédients. Recharge la page.'
        );
      } else {
        setCuisineTypes(cuisineRes.data ?? []);
        setDifficulties(difficultyRes.data ?? []);
        setUnits(unitRes.data ?? []);
        setActiveIngredients(ingredientsRes.data ?? []);
      }

      setLoadingRefs(false);
    }

    loadRefs();
  }, []);

  /**
   * Recherche d'ingrédients existants.
   *
   * La recherche est faite côté navigateur après normalisation Unicode.
   * Cela permet notamment de considérer :
   *
   *   Œuf === oeuf === OEUF
   *
   * contrairement à une simple requête SQL ilike(), qui ne traite
   * pas nécessairement Œ et OE comme équivalents.
   */
  useEffect(() => {
    const search = normalizeIngredientName(ingredientSearch);

    if (search.length < 2) {
      setIngredientResults([]);
      return;
    }

    const results = activeIngredients
      .filter((ingredient) => {
        const ingredientName = normalizeIngredientName(ingredient.name.fr);
        return ingredientName.includes(search);
      })
      .slice(0, 8);

    setIngredientResults(results);
  }, [ingredientSearch, activeIngredients]);

  function addStep() {
    setSteps((prev) => [...prev, '']);
  }

  function updateStep(index: number, value: string) {
    setSteps((prev) => prev.map((s, i) => (i === index ? value : s)));
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function addTag() {
    const t = tagInput.trim();

    if (t && !tags.includes(t)) {
      setTags((prev) => [...prev, t]);
    }

    setTagInput('');
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function selectExistingIngredient(option: IngredientOption) {
    setIngredientLines((prev) => [
      ...prev,
      {
        ingredient_id: option.id,
        name_fr: option.name.fr,
        is_new: false,
        quantity: null,
        unit_id: null,
      },
    ]);

    setIngredientSearch('');
    setIngredientResults([]);
  }

  /**
   * Création d'un nouvel ingrédient.
   *
   * Une seconde vérification est effectuée juste avant l'insertion.
   * Elle empêche de créer un doublon si l'utilisateur saisit par exemple
   * "oeuf" alors que "Œuf" existe déjà en base.
   */
  async function createPendingIngredient(nameTyped: string) {
    if (!cmsUser) return;

    const cleanName = nameTyped.trim();

    if (!cleanName) return;

    const normalizedTypedName = normalizeIngredientName(cleanName);

    // Première sécurité : vérifier les ingrédients déjà chargés.
    const existingIngredient = activeIngredients.find(
      (ingredient) =>
        normalizeIngredientName(ingredient.name.fr) === normalizedTypedName
    );

    if (existingIngredient) {
      selectExistingIngredient(existingIngredient);
      return;
    }

    // Deuxième sécurité : relire la base juste avant l'insertion.
    // Cela évite un doublon si la liste locale n'était pas encore à jour.
    const { data: existingIngredients, error: existingError } = await supabase
      .from('ingredients')
      .select('id, name, status')
      .eq('status', 'active');

    if (existingError) {
      setFormError(
        `Impossible de vérifier si l'ingrédient "${cleanName}" existe déjà : ${existingError.message}`
      );
      return;
    }

    const existingFromDatabase = (existingIngredients ?? []).find(
      (ingredient) =>
        normalizeIngredientName(ingredient.name.fr) === normalizedTypedName
    );

    if (existingFromDatabase) {
      setActiveIngredients((prev) => {
        if (prev.some((ingredient) => ingredient.id === existingFromDatabase.id)) {
          return prev;
        }

        return [...prev, existingFromDatabase];
      });

      selectExistingIngredient(existingFromDatabase);
      return;
    }

    // Aucun ingrédient existant ne correspond :
    // on peut réellement créer la demande.
    const { data, error } = await supabase
      .from('ingredients')
      .insert({
        name: { fr: cleanName },
        status: 'pending',
        requested_by: cmsUser.id,
      })
      .select('id, name, status')
      .single();

    if (error || !data) {
      setFormError(
        `Impossible de créer l'ingrédient "${cleanName}" : ${
          error?.message ?? 'erreur inconnue'
        }`
      );
      return;
    }

    setIngredientLines((prev) => [
      ...prev,
      {
        ingredient_id: data.id,
        name_fr: data.name.fr,
        is_new: true,
        quantity: null,
        unit_id: null,
      },
    ]);

    setIngredientSearch('');
    setIngredientResults([]);
  }

  function updateIngredientLine(
    index: number,
    patch: Partial<DraftIngredientLine>
  ) {
    setIngredientLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l))
    );
  }

  function removeIngredientLine(index: number) {
    setIngredientLines((prev) => prev.filter((_, i) => i !== index));
  }

  function validateForSubmission(): string | null {
    if (!nameFr.trim()) return 'Le titre est obligatoire.';

    const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);

    if (cleanSteps.length === 0) {
      return 'Au moins une étape de préparation est obligatoire.';
    }

    if (cuisineTypeId === '') {
      return 'Le type de cuisine est obligatoire.';
    }

    if (difficultyId === '') {
      return 'La difficulté est obligatoire.';
    }

    if (cookingTime === '' || cookingTime <= 0) {
      return 'La durée de cuisson est obligatoire.';
    }

    if (servings === '' || servings <= 0) {
      return 'Le nombre de personnes est obligatoire.';
    }

    if (ingredientLines.length === 0) {
      return 'Au moins un ingrédient est obligatoire.';
    }

    for (const line of ingredientLines) {
      if (line.quantity == null || line.quantity <= 0) {
        return `Quantité manquante pour "${line.name_fr}".`;
      }

      if (line.unit_id == null) {
        return `Unité manquante pour "${line.name_fr}".`;
      }
    }

    if (!imageFile) {
      return 'Une photo est obligatoire.';
    }

    return null;
  }

  async function uploadImageIfNeeded(): Promise<string | null> {
    if (!imageFile) return null;

    const ext = imageFile.name.split('.').pop() || 'jpg';
    const path = `${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from('dish-images')
      .upload(path, imageFile, { upsert: false });

    if (error) {
      throw new Error(`Échec de l'upload de l'image : ${error.message}`);
    }

    const { data } = supabase.storage
      .from('dish-images')
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async function handleSave(submit: boolean) {
    if (!cmsUser) return;

    setFormError(null);
    setFormNotice(null);

    if (submit) {
      const validationError = validateForSubmission();

      if (validationError) {
        setFormError(validationError);
        return;
      }
    } else if (!nameFr.trim()) {
      setFormError(
        'Un titre minimal est nécessaire, même pour enregistrer un brouillon.'
      );
      return;
    }

    setSaving(true);

    try {
      const imageUrl = await uploadImageIfNeeded();
      const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);

      const payload = {
        writer_id: cmsUser.id,
        status: submit ? 'soumis' : 'brouillon',
        name_fr: nameFr.trim(),
        description_fr: descriptionFr.trim() || null,
        steps_fr: cleanSteps,
        cooking_time: cookingTime === '' ? null : cookingTime,
        servings: servings === '' ? null : servings,
        cuisine_type_id: cuisineTypeId === '' ? null : cuisineTypeId,
        difficulty_id: difficultyId === '' ? null : difficultyId,
        calories: calories === '' ? null : calories,
        tags_fr: tags,
        image_url: imageUrl,
        ingredients: ingredientLines,
        submitted_at: submit ? new Date().toISOString() : null,
      };

      const { error } = await supabase
        .from('recipe_drafts')
        .insert(payload);

      if (error) {
        throw new Error(error.message);
      }

      setFormNotice(
        submit
          ? 'Recette soumise à validation.'
          : 'Brouillon enregistré.'
      );

      if (submit) {
        setTimeout(() => navigate('/'), 1200);
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Erreur inconnue.'
      );
    } finally {
      setSaving(false);
    }
  }

  if (loadingRefs) {
    return <p>Chargement du formulaire…</p>;
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '40px auto',
        fontFamily: 'sans-serif',
      }}
    >
      <h1>Nouvelle recette</h1>

      {formError && (
        <p style={{ color: '#b00020' }}>
          {formError}
        </p>
      )}

      {formNotice && (
        <p style={{ color: '#0a7d2c' }}>
          {formNotice}
        </p>
      )}

      <div style={sectionStyle}>
        <label style={labelStyle}>Titre *</label>

        <input
          style={inputStyle}
          value={nameFr}
          onChange={(e) => setNameFr(e.target.value)}
        />

        <label style={labelStyle}>Description</label>

        <textarea
          style={{ ...inputStyle, minHeight: 60 }}
          value={descriptionFr}
          onChange={(e) => setDescriptionFr(e.target.value)}
        />

        <label style={labelStyle}>
          Étapes de préparation *
        </label>

        {steps.map((step, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span style={{ paddingTop: 8 }}>
              {i + 1}.
            </span>

            <textarea
              style={{
                ...inputStyle,
                margin: 0,
                flex: 1,
              }}
              value={step}
              onChange={(e) =>
                updateStep(i, e.target.value)
              }
            />

            {steps.length > 1 && (
              <button
                type="button"
                onClick={() => removeStep(i)}
              >
                ✕
              </button>
            )}
          </div>
        ))}

        <button type="button" onClick={addStep}>
          + Ajouter une étape
        </button>
      </div>

      <div style={sectionStyle}>
        <label style={labelStyle}>
          Type de cuisine *
        </label>

        <select
          style={inputStyle}
          value={cuisineTypeId}
          onChange={(e) =>
            setCuisineTypeId(
              e.target.value ? Number(e.target.value) : ''
            )
          }
        >
          <option value="">— Choisir —</option>

          {cuisineTypes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name.fr}
            </option>
          ))}
        </select>

        <label style={labelStyle}>
          Difficulté *
        </label>

        <div
          style={{
            marginTop: 4,
            marginBottom: 16,
          }}
        >
          {difficulties.map((d) => (
            <label
              key={d.id}
              style={{
                marginRight: 16,
                fontWeight: 400,
              }}
            >
              <input
                type="radio"
                name="difficulty"
                checked={difficultyId === d.id}
                onChange={() =>
                  setDifficultyId(d.id)
                }
              />{' '}
              {d.label.fr}
            </label>
          ))}
        </div>

        <label style={labelStyle}>
          Durée de cuisson (minutes) *
        </label>

        <input
          type="number"
          style={inputStyle}
          value={cookingTime}
          onChange={(e) =>
            setCookingTime(
              e.target.value ? Number(e.target.value) : ''
            )
          }
        />

        <label style={labelStyle}>
          Nombre de personnes *
        </label>

        <input
          type="number"
          style={inputStyle}
          value={servings}
          onChange={(e) =>
            setServings(
              e.target.value ? Number(e.target.value) : ''
            )
          }
        />

        <label style={labelStyle}>
          Calories totales (kcal) — estimation, optionnel
        </label>

        <input
          type="number"
          style={inputStyle}
          value={calories}
          onChange={(e) =>
            setCalories(
              e.target.value ? Number(e.target.value) : ''
            )
          }
        />
      </div>

      <div style={sectionStyle}>
        <label style={labelStyle}>
          Ingrédients *
        </label>

        {ingredientLines.map((line, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              marginBottom: 8,
            }}
          >
            <span style={{ flex: 2 }}>
              {line.name_fr}{' '}
              {line.is_new && (
                <em style={{ color: '#b06d00' }}>
                  (nouveau — en attente)
                </em>
              )}
            </span>

            <input
              type="number"
              placeholder="Quantité"
              style={{
                ...inputStyle,
                margin: 0,
                flex: 1,
              }}
              value={line.quantity ?? ''}
              onChange={(e) =>
                updateIngredientLine(i, {
                  quantity: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            />

            <select
              style={{
                ...inputStyle,
                margin: 0,
                flex: 1,
              }}
              value={line.unit_id ?? ''}
              onChange={(e) =>
                updateIngredientLine(i, {
                  unit_id: e.target.value
                    ? Number(e.target.value)
                    : null,
                })
              }
            >
              <option value="">Unité</option>

              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label.fr}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() =>
                removeIngredientLine(i)
              }
            >
              ✕
            </button>
          </div>
        ))}

        <div style={{ position: 'relative' }}>
          <input
            style={inputStyle}
            placeholder="Rechercher un ingrédient…"
            value={ingredientSearch}
            onChange={(e) =>
              setIngredientSearch(e.target.value)
            }
          />

          {ingredientResults.length > 0 && (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                border: '1px solid #ccc',
                position: 'absolute',
                background: 'white',
                width: '100%',
                zIndex: 1,
              }}
            >
              {ingredientResults.map((opt) => (
                <li
                  key={opt.id}
                  style={{
                    padding: 8,
                    cursor: 'pointer',
                  }}
                  onClick={() =>
                    selectExistingIngredient(opt)
                  }
                >
                  {opt.name.fr}
                </li>
              ))}
            </ul>
          )}

          {ingredientSearch.trim().length >= 2 &&
            ingredientResults.length === 0 && (
              <button
                type="button"
                onClick={() =>
                  createPendingIngredient(
                    ingredientSearch.trim()
                  )
                }
              >
                + Créer l'ingrédient "
                {ingredientSearch.trim()}"
                (nouveau, en attente de validation admin)
              </button>
            )}
        </div>
      </div>

      <div style={sectionStyle}>
        <label style={labelStyle}>Tags</label>

        <div style={{ marginBottom: 8 }}>
          {tags.map((t) => (
            <span
              key={t}
              style={{
                display: 'inline-block',
                background: '#eee',
                borderRadius: 12,
                padding: '4px 10px',
                marginRight: 6,
              }}
            >
              {t}{' '}
              <span
                style={{ cursor: 'pointer' }}
                onClick={() => removeTag(t)}
              >
                ✕
              </span>
            </span>
          ))}
        </div>

        <input
          style={inputStyle}
          placeholder="Taper un tag puis Entrée"
          value={tagInput}
          onChange={(e) =>
            setTagInput(e.target.value)
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
        />

        <label style={labelStyle}>
          Photo *
        </label>

        <input
          type="file"
          accept="image/*"
          style={inputStyle}
          onChange={(e) =>
            setImageFile(
              e.target.files?.[0] ?? null
            )
          }
        />
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button
          type="button"
          disabled={saving}
          onClick={() => handleSave(false)}
        >
          Enregistrer comme brouillon
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => handleSave(true)}
        >
          Soumettre à validation
        </button>
      </div>
    </div>
  );
}
```
