import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface DraftIngredientLine {
  ingredient_id: number;
  name_fr: string;
  is_new: boolean;
  quantity: number | null;
  unit_id: number | null;
  no_measure: boolean;
}

interface IngredientOption {
  id: number;
  name: { fr: string };
  no_measure: boolean;
}

interface UnitOption {
  id: number;
  label: { fr: string };
}

interface EditableDraft {
  id: string;
  name_fr: string;
  description_fr: string | null;
  steps_fr: string[];
  tags_fr: string[];
  ingredients: DraftIngredientLine[];
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px',
  marginTop: 4,
  marginBottom: 10,
  boxSizing: 'border-box',
};

// Même logique que RecipeForm.tsx — nécessaire ici aussi pour que la
// recherche d'ingrédients traite Œ/œ/Æ/æ comme leurs équivalents non ligaturés.
function normalizeIngredientName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\u0152/g, 'OE')
    .replace(/\u0153/g, 'oe')
    .replace(/\u00C6/g, 'AE')
    .replace(/\u00E6/g, 'ae')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export default function EditableRecipeDraft({
  draft,
  activeIngredients,
  units,
  writerId,
  onSaved,
  onCancel,
}: {
  draft: EditableDraft;
  activeIngredients: IngredientOption[];
  units: UnitOption[];
  writerId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [nameFr, setNameFr] = useState(draft.name_fr);
  const [descriptionFr, setDescriptionFr] = useState(draft.description_fr ?? '');
  const [steps, setSteps] = useState<string[]>(draft.steps_fr.length ? draft.steps_fr : ['']);
  const [tags, setTags] = useState<string[]>(draft.tags_fr);
  const [tagInput, setTagInput] = useState('');
  const [lines, setLines] = useState<DraftIngredientLine[]>(draft.ingredients);

  const [ingredientSearch, setIngredientSearch] = useState('');
  const [ingredientResults, setIngredientResults] = useState<IngredientOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateStep(i: number, value: string) {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }
  function addStep() {
    setSteps((prev) => [...prev, '']);
  }
  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addTag() {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput('');
  }
  function removeTag(t: string) {
    setTags((prev) => prev.filter((x) => x !== t));
  }

  function handleIngredientSearch(value: string) {
    setIngredientSearch(value);
    const search = normalizeIngredientName(value);
    if (search.length < 2) {
      setIngredientResults([]);
      return;
    }
    const results = activeIngredients
      .filter((ing) => normalizeIngredientName(ing.name.fr).includes(search))
      .filter((ing) => !lines.some((l) => l.ingredient_id === ing.id))
      .slice(0, 8);
    setIngredientResults(results);
  }

  function addIngredientLine(option: IngredientOption) {
    setLines((prev) => [
      ...prev,
      { ingredient_id: option.id, name_fr: option.name.fr, is_new: false, quantity: null, unit_id: null, no_measure: option.no_measure },
    ]);
    setIngredientSearch('');
    setIngredientResults([]);
  }

  async function createAndAddIngredient(nameTyped: string) {
    const clean = nameTyped.trim();
    if (!clean) return;
    const { data, error: insertError } = await supabase
      .from('ingredients')
      .insert({ name: { fr: clean }, status: 'pending', requested_by: writerId })
      .select('id, name, no_measure')
      .single();
    if (insertError || !data) {
      setError(`Impossible de créer l'ingrédient : ${insertError?.message ?? 'erreur inconnue'}`);
      return;
    }
    setLines((prev) => [
      ...prev,
      { ingredient_id: data.id, name_fr: data.name.fr, is_new: true, quantity: null, unit_id: null, no_measure: false },
    ]);
    setIngredientSearch('');
    setIngredientResults([]);
  }

  function updateLine(i: number, patch: Partial<DraftIngredientLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSave() {
    if (!nameFr.trim()) {
      setError('Le titre ne peut pas être vide.');
      return;
    }
    for (const line of lines) {
      if (line.no_measure) continue;
      if (line.quantity == null || line.quantity <= 0 || line.unit_id == null) {
        setError(`Quantité ou unité manquante pour "${line.name_fr}".`);
        return;
      }
    }

    setSaving(true);
    setError(null);

    const { error: updateError } = await supabase
      .from('recipe_drafts')
      .update({
        name_fr: nameFr.trim(),
        description_fr: descriptionFr.trim() || null,
        steps_fr: steps.map((s) => s.trim()).filter(Boolean),
        tags_fr: tags,
        ingredients: lines,
      })
      .eq('id', draft.id);

    setSaving(false);

    if (updateError) {
      setError(`Échec de l'enregistrement : ${updateError.message}`);
      return;
    }
    onSaved();
  }

  return (
    <div style={{ background: '#fafafa', border: '1px solid #ccc', borderRadius: 6, padding: 12, marginTop: 8 }}>
      {error && <p style={{ color: '#b00020' }}>{error}</p>}

      <label>Titre</label>
      <input style={inputStyle} value={nameFr} onChange={(e) => setNameFr(e.target.value)} />

      <label>Description</label>
      <textarea
        style={{ ...inputStyle, minHeight: 60 }}
        value={descriptionFr}
        onChange={(e) => setDescriptionFr(e.target.value)}
      />

      <label>Étapes</label>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <span style={{ paddingTop: 6 }}>{i + 1}.</span>
          <textarea
            style={{ ...inputStyle, margin: 0, flex: 1 }}
            value={s}
            onChange={(e) => updateStep(i, e.target.value)}
          />
          {steps.length > 1 && (
            <button type="button" onClick={() => removeStep(i)}>✕</button>
          )}
        </div>
      ))}
      <button type="button" onClick={addStep}>+ Ajouter une étape</button>

      <div style={{ marginTop: 12 }}>
        <label>Tags</label>
        <div style={{ marginBottom: 6 }}>
          {tags.map((t) => (
            <span
              key={t}
              style={{ display: 'inline-block', background: '#eee', borderRadius: 12, padding: '4px 10px', marginRight: 6 }}
            >
              {t} <span style={{ cursor: 'pointer' }} onClick={() => removeTag(t)}>✕</span>
            </span>
          ))}
        </div>
        <input
          style={inputStyle}
          placeholder="Taper un tag puis Entrée"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag();
            }
          }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label>Ingrédients</label>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span style={{ flex: 2 }}>
              {line.name_fr} {line.is_new && <em style={{ color: '#b06d00' }}>(nouveau)</em>}
            </span>
            {line.no_measure ? (
              <span style={{ flex: 2, color: '#666', fontStyle: 'italic' }}>Pas de quantité à préciser</span>
            ) : (
              <>
                <input
                  type="number"
                  placeholder="Quantité"
                  style={{ ...inputStyle, margin: 0, flex: 1 }}
                  value={line.quantity ?? ''}
                  onChange={(e) => updateLine(i, { quantity: e.target.value ? Number(e.target.value) : null })}
                />
                <select
                  style={{ ...inputStyle, margin: 0, flex: 1 }}
                  value={line.unit_id ?? ''}
                  onChange={(e) => updateLine(i, { unit_id: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Unité</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>{u.label.fr}</option>
                  ))}
                </select>
              </>
            )}
            <button type="button" onClick={() => removeLine(i)}>✕</button>
          </div>
        ))}

        <div style={{ position: 'relative' }}>
          <input
            style={inputStyle}
            placeholder="Ajouter un ingrédient…"
            value={ingredientSearch}
            onChange={(e) => handleIngredientSearch(e.target.value)}
          />
          {ingredientResults.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid #ccc', position: 'absolute', background: 'white', width: '100%', zIndex: 1 }}>
              {ingredientResults.map((opt) => (
                <li key={opt.id} style={{ padding: 8, cursor: 'pointer' }} onClick={() => addIngredientLine(opt)}>
                  {opt.name.fr}
                </li>
              ))}
            </ul>
          )}
          {ingredientSearch.trim().length >= 2 && ingredientResults.length === 0 && (
            <button type="button" onClick={() => createAndAddIngredient(ingredientSearch.trim())}>
              + Créer "{ingredientSearch.trim()}" (nouveau, en attente)
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" disabled={saving} onClick={handleSave}>
          {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
        </button>
        <button type="button" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}
