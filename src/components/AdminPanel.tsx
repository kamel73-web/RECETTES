import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import EditableRecipeDraft from "./EditableRecipeDraft";
import ManageWriters from "./ManageWriters";
interface DraftIngredientLine {
  ingredient_id: number;
  name_fr: string;
  is_new: boolean;
  quantity: number | null;
  unit_id: number | null;
  no_measure: boolean;
}

interface RecipeDraft {
  id: string;
  name_fr: string;
  description_fr: string | null;
  steps_fr: string[];
  cooking_time: number | null;
  servings: number | null;
  cuisine_type_id: number | null;
  difficulty_id: number | null;
  calories: number | null;
  tags_fr: string[];
  image_url: string | null;
  ingredients: DraftIngredientLine[];
  submitted_at: string | null;
  writer: { display_name: string } | null;
}

interface PendingIngredient {
  id: number;
  name: { fr: string };
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

interface CategoryOption {
  fr: string;
  full: Record<string, string>;
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 6,
  padding: 16,
  marginBottom: 20,
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "6px",
  marginTop: 4,
  marginBottom: 10,
  boxSizing: "border-box",
};

export default function AdminPanel() {
  const { cmsUser } = useAuth();
  const [drafts, setDrafts] = useState<RecipeDraft[]>([]);
  const [pendingIngredients, setPendingIngredients] = useState<
    PendingIngredient[]
  >([]);
  const [pendingIngredientIds, setPendingIngredientIds] = useState<Set<number>>(
    new Set(),
  );
  const [activeIngredients, setActiveIngredients] = useState<
    IngredientOption[]
  >([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [draftsRes, pendingRes, activeRes, unitsRes, categoriesRes] = await Promise.all([
      supabase
        .from("recipe_drafts")
        .select("*, writer:cms_users(display_name)")
        .eq("status", "soumis")
        .order("submitted_at", { ascending: true }),
      supabase.from("ingredients").select("id, name").eq("status", "pending"),
      supabase.from("ingredients").select("id, name, no_measure").eq("status", "active"),
      supabase.from("measurement_units").select("id, label").order("id"),
      supabase.from("ingredients").select("category").not("category", "is", null),
    ]);

    if (
      draftsRes.error ||
      pendingRes.error ||
      activeRes.error ||
      unitsRes.error
    ) {
      setError(
        `Erreur au chargement : ${
          draftsRes.error?.message ??
          pendingRes.error?.message ??
          activeRes.error?.message ??
          unitsRes.error?.message
        }`,
      );
    } else {
      setDrafts((draftsRes.data ?? []) as unknown as RecipeDraft[]);
      setPendingIngredients(pendingRes.data ?? []);
      setPendingIngredientIds(
        new Set((pendingRes.data ?? []).map((i) => i.id)),
      );
      setActiveIngredients(activeRes.data ?? []);
      setUnits(unitsRes.data ?? []);

      // Déduplication des catégories par valeur "fr" (insensible à la casse/espaces) :
      // une même valeur affichée peut être stockée avec des variantes de traduction
      // selon qui l'a créée. On garde le premier objet rencontré pour chaque clé.
      const catMap = new Map<string, Record<string, string>>();
      for (const row of categoriesRes.data ?? []) {
        const cat = row.category as Record<string, string> | null;
        if (!cat?.fr) continue;
        const key = cat.fr.trim().toLowerCase();
        if (!catMap.has(key)) catMap.set(key, cat);
      }
      setCategories(
        Array.from(catMap.values())
          .map((full) => ({ fr: full.fr, full }))
          .sort((a, b) => a.fr.localeCompare(b.fr))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [calorieDrafts, setCalorieDrafts] = useState<Record<string, string>>(
    {},
  );
  const [savingCaloriesId, setSavingCaloriesId] = useState<string | null>(null);

  async function saveCalories(draft: RecipeDraft) {
    const raw = calorieDrafts[draft.id];
    const value = raw ? parseInt(raw, 10) : NaN;
    if (!raw || Number.isNaN(value) || value <= 0) {
      setError("Calories invalides.");
      return;
    }
    setSavingCaloriesId(draft.id);
    setError(null);
    const { error: updateError } = await supabase
      .from("recipe_drafts")
      .update({ calories: value })
      .eq("id", draft.id);
    setSavingCaloriesId(null);
    if (updateError) {
      setError(
        `Échec de l'enregistrement des calories : ${updateError.message}`,
      );
      return;
    }
    load();
  }

  async function approveDraft(draft: RecipeDraft) {
    setApprovingId(draft.id);
    setError(null);
    setNotice(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;

    const { data, error: fnError } = await supabase.functions.invoke(
      "approve-recipe",
      {
        body: { draft_id: draft.id },
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
      },
    );

    setApprovingId(null);

    if (fnError) {
      let detail = fnError.message;
      const ctx = (fnError as unknown as { context?: Response }).context;
      if (ctx) {
        try {
          const body = await ctx.json();
          if (body?.error) detail = body.error;
        } catch {
          // corps non exploitable, on garde le message générique
        }
      }
      setError(`Échec de l'approbation : ${detail}`);
      return;
    }
    if (data?.error) {
      setError(data.error);
      return;
    }

    setNotice(
      `"${draft.name_fr}" approuvée et publiée (dish_id=${data.dish_id}).`,
    );
    load();
  }

  async function rejectDraft(draft: RecipeDraft) {
    const reason = window.prompt(`Motif de rejet pour "${draft.name_fr}" :`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError("Un motif de rejet est requis.");
      return;
    }
    const { error: updateError } = await supabase
      .from("recipe_drafts")
      .update({
        status: "rejete",
        admin_notes: reason.trim(),
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", draft.id);

    if (updateError) {
      setError(`Échec du rejet : ${updateError.message}`);
      return;
    }
    setNotice(`"${draft.name_fr}" rejetée.`);
    load();
  }

  if (cmsUser?.role !== "admin") return null;

  return (
    <div
      style={{ maxWidth: 900, margin: "40px auto", fontFamily: "sans-serif" }}
    >
      <h2>Espace admin</h2>
      {error && <p style={{ color: "#b00020" }}>{error}</p>}
      {notice && <p style={{ color: "#0a7d2c" }}>{notice}</p>}
      {loading && <p>Chargement…</p>}

      {!loading && (
        <>
          <ManageWriters />

          <div style={sectionStyle}>
            <h3>Ingrédients en attente ({pendingIngredients.length})</h3>
            {pendingIngredients.length === 0 && (
              <p style={{ color: "#666" }}>Aucun.</p>
            )}
            {pendingIngredients.map((ing) => (
              <PendingIngredientRow
                key={ing.id}
                ingredient={ing}
                categories={categories}
                onCompleted={load}
                onDeleted={load}
              />
            ))}
          </div>

          <div style={sectionStyle}>
            <h3>Recettes en attente de validation ({drafts.length})</h3>
            {drafts.length === 0 && <p style={{ color: "#666" }}>Aucune.</p>}
            {drafts.map((draft) => {
              const blockingIngredients = draft.ingredients.filter((l) =>
                pendingIngredientIds.has(l.ingredient_id),
              );
              const isEditing = editingId === draft.id;

              return (
                <div
                  key={draft.id}
                  style={{
                    borderTop: "1px solid #eee",
                    paddingTop: 12,
                    marginTop: 12,
                  }}
                >
                  <strong>{draft.name_fr}</strong>{" "}
                  <span style={{ color: "#666" }}>
                    — rédigé par {draft.writer?.display_name ?? "?"}, soumis le{" "}
                    {draft.submitted_at
                      ? new Date(draft.submitted_at).toLocaleDateString("fr-FR")
                      : "?"}
                  </span>
                  {!isEditing && (
                    <>
                      {draft.image_url && (
                        <div>
                          <img
                            src={draft.image_url}
                            alt={draft.name_fr}
                            style={{ maxWidth: 200, marginTop: 8 }}
                          />
                        </div>
                      )}

                      {draft.description_fr && <p>{draft.description_fr}</p>}

                      <p>
                        <strong>Étapes :</strong>
                      </p>
                      <ol>
                        {draft.steps_fr.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>

                      <p>
                        <strong>Ingrédients :</strong>{" "}
                        {draft.ingredients
                          .map((l) => `${l.name_fr} (${l.quantity ?? "?"})`)
                          .join(", ")}
                      </p>

                      <p>
                        <strong>Calories :</strong>{" "}
                        {draft.calories ?? (
                          <span>
                            <em style={{ color: "#b06d00" }}>manquantes — </em>
                            <input
                              type="number"
                              placeholder="kcal"
                              style={{ width: 80 }}
                              value={calorieDrafts[draft.id] ?? ""}
                              onChange={(e) =>
                                setCalorieDrafts((prev) => ({
                                  ...prev,
                                  [draft.id]: e.target.value,
                                }))
                              }
                            />
                            <button
                              type="button"
                              disabled={savingCaloriesId === draft.id}
                              onClick={() => saveCalories(draft)}
                            >
                              {savingCaloriesId === draft.id
                                ? "Enregistrement…"
                                : "Renseigner"}
                            </button>
                          </span>
                        )}
                      </p>

                      {blockingIngredients.length > 0 && (
                        <p style={{ color: "#b06d00" }}>
                          ⚠ Ingrédient(s) encore en attente, à compléter avant
                          validation :{" "}
                          {blockingIngredients.map((l) => l.name_fr).join(", ")}
                        </p>
                      )}

                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          type="button"
                          disabled={
                            blockingIngredients.length > 0 ||
                            approvingId === draft.id
                          }
                          title={
                            blockingIngredients.length > 0
                              ? "Complète d'abord les ingrédients en attente"
                              : undefined
                          }
                          onClick={() => approveDraft(draft)}
                        >
                          {approvingId === draft.id
                            ? "Approbation en cours…"
                            : "Approuver"}
                        </button>
                        <button
                          type="button"
                          onClick={() => rejectDraft(draft)}
                        >
                        Rejeter
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(draft.id)}
                      >
                        Corriger
                      </button>
                      </div>
                    </>
                  )}
                  {isEditing && (
                    <EditableRecipeDraft
                      draft={draft}
                      activeIngredients={activeIngredients}
                      units={units}
                      writerId={cmsUser.id}
                      onSaved={() => {
                        setEditingId(null);
                        load();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function PendingIngredientRow({
  ingredient,
  categories,
  onCompleted,
  onDeleted,
}: {
  ingredient: PendingIngredient;
  categories: CategoryOption[];
  onCompleted: () => void;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);

  const [categorySearch, setCategorySearch] = useState("");
  const [categoryResults, setCategoryResults] = useState<CategoryOption[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<CategoryOption | null>(null);
  const [translatingCategory, setTranslatingCategory] = useState(false);

  const [minQuantity, setMinQuantity] = useState<number | "">("");
  const [noMeasure, setNoMeasure] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  function handleCategorySearch(value: string) {
    setCategorySearch(value);
    setSelectedCategory(null);
    const q = value.trim().toLowerCase();
    if (q.length < 2) {
      setCategoryResults([]);
      return;
    }
    setCategoryResults(
      categories.filter((c) => c.fr.toLowerCase().includes(q)).slice(0, 8)
    );
  }

  function selectCategory(cat: CategoryOption) {
    setSelectedCategory(cat);
    setCategorySearch(cat.fr);
    setCategoryResults([]);
  }

  // MyMemory ne traduit qu'un texte à la fois. Appel direct depuis le navigateur
  // (même service que l'Edge Function approve-recipe, pas d'authentification requise) —
  // volume négligeable ici (un seul mot ou groupe de mots par nouvelle catégorie).
  async function translateOne(text: string, targetLang: string): Promise<string> {
    const params = new URLSearchParams({ q: text, langpair: `fr|${targetLang}` });
    const res = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
    if (!res.ok) throw new Error(`Échec traduction (${targetLang}) : HTTP ${res.status}`);
    const data = await res.json();
    if (data.responseStatus && data.responseStatus !== 200) {
      throw new Error(`Échec traduction (${targetLang}) : ${data.responseDetails ?? data.responseStatus}`);
    }
    return data.responseData?.translatedText ?? "";
  }

  async function createNewCategory() {
    const clean = categorySearch.trim();
    if (!clean) return;

    // Sécurité anti-doublon, comme pour les ingrédients : re-vérifier avant de créer.
    const existing = categories.find((c) => c.fr.toLowerCase() === clean.toLowerCase());
    if (existing) {
      selectCategory(existing);
      return;
    }

    setTranslatingCategory(true);
    setRowError(null);
    try {
      const [en, ar, it, es] = await Promise.all([
        translateOne(clean, "en"),
        translateOne(clean, "ar"),
        translateOne(clean, "it"),
        translateOne(clean, "es"),
      ]);
      const full = { fr: clean, en, ar, it, es };
      setSelectedCategory({ fr: clean, full });
      setCategorySearch(clean);
      setCategoryResults([]);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Erreur de traduction.");
    } finally {
      setTranslatingCategory(false);
    }
  }

  async function complete() {
    if (!selectedCategory) {
      setRowError("Choisis une catégorie existante ou crée-en une nouvelle avant de valider.");
      return;
    }

    setSaving(true);
    setRowError(null);
    try {
      let imageUrl: string | null = null;
      if (imageFile) {
        const ext = imageFile.name.split(".").pop() || "jpg";
        const path = `ingredients/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("dish-images")
          .upload(path, imageFile, { upsert: false });
        if (uploadError)
          throw new Error(`Échec de l'upload : ${uploadError.message}`);
        const { data } = supabase.storage
          .from("dish-images")
          .getPublicUrl(path);
        imageUrl = data.publicUrl;
      }

      const { error: updateError } = await supabase
        .from("ingredients")
        .update({
          category: selectedCategory.full,
          min_quantity: minQuantity === "" ? null : minQuantity,
          no_measure: noMeasure,
          image_url: imageUrl,
          status: "active",
        })
        .eq("id", ingredient.id);

      if (updateError) throw new Error(updateError.message);
      onCompleted();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Supprimer définitivement "${ingredient.name.fr}" ? Cette action est irréversible.`)) {
      return;
    }

    setDeleting(true);
    setRowError(null);
    try {
      // Vérification d'intégrité : un brouillon (quel que soit son statut) qui
      // référence encore cet ingrédient empêcherait ensuite son approbation
      // (dish_ingredients.ingredient_id pointerait sur une ligne inexistante).
      const { data: allDrafts, error: draftsError } = await supabase
        .from("recipe_drafts")
        .select("id, name_fr, ingredients");

      if (draftsError) throw new Error(draftsError.message);

      const referencing = (allDrafts ?? []).filter((d) =>
        (d.ingredients as { ingredient_id: number }[]).some(
          (line) => line.ingredient_id === ingredient.id
        )
      );

      if (referencing.length > 0) {
        const names = referencing.map((d) => `"${d.name_fr}"`).join(", ");
        throw new Error(
          `Impossible de supprimer : utilisé dans ${referencing.length} brouillon(s) (${names}). Supprime-le d'abord de ces recettes.`
        );
      }

      const { error: deleteError } = await supabase
        .from("ingredients")
        .delete()
        .eq("id", ingredient.id);

      if (deleteError) throw new Error(deleteError.message);
      onDeleted();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "Erreur inconnue.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{ingredient.name.fr}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setOpen((o) => !o)}>
            {open ? "Fermer" : "Compléter"}
          </button>
          <button type="button" disabled={deleting} onClick={remove}>
            {deleting ? "Suppression…" : "Supprimer"}
          </button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          {rowError && <p style={{ color: "#b00020" }}>{rowError}</p>}

          <label>Catégorie</label>
          <div style={{ position: "relative" }}>
            <input
              style={inputStyle}
              placeholder="Rechercher une catégorie existante…"
              value={categorySearch}
              onChange={(e) => handleCategorySearch(e.target.value)}
            />
            {categoryResults.length > 0 && (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  border: "1px solid #ccc",
                  position: "absolute",
                  background: "white",
                  width: "100%",
                  zIndex: 1,
                }}
              >
                {categoryResults.map((c) => (
                  <li
                    key={c.fr}
                    style={{ padding: 8, cursor: "pointer" }}
                    onClick={() => selectCategory(c)}
                  >
                    {c.fr}
                  </li>
                ))}
              </ul>
            )}
            {selectedCategory && (
              <p style={{ fontSize: 13, color: "green", margin: "4px 0" }}>
                ✓ {selectedCategory.fr}
              </p>
            )}
            {!selectedCategory &&
              categorySearch.trim().length >= 2 &&
              categoryResults.length === 0 && (
                <button type="button" disabled={translatingCategory} onClick={createNewCategory}>
                  {translatingCategory
                    ? "Traduction…"
                    : `+ Créer la catégorie "${categorySearch.trim()}"`}
                </button>
              )}
          </div>

          <label>Quantité minimale (liste de courses)</label>
          <input
            type="number"
            style={inputStyle}
            value={minQuantity}
            onChange={(e) =>
              setMinQuantity(e.target.value ? Number(e.target.value) : "")
            }
          />
          <label>
            <input
              type="checkbox"
              checked={noMeasure}
              onChange={(e) => setNoMeasure(e.target.checked)}
            />{" "}
            Sans unité de mesure (no_measure)
          </label>
          <label style={{ display: "block", marginTop: 8 }}>
            Image (optionnel)
          </label>
          <input
            type="file"
            accept="image/*"
            style={inputStyle}
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
          />
          <button type="button" disabled={saving} onClick={complete}>
            Valider cet ingrédient (passe en "active")
          </button>
        </div>
      )}
    </div>
  );
}
