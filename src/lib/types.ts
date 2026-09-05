export interface I18nText {
  fr: string;
  en?: string;
  ar?: string;
  it?: string;
  es?: string;
  [key: string]: string | undefined;
}

export interface CuisineType {
  id: number;
  name: I18nText;
}

export interface Difficulty {
  id: number;
  label: I18nText;
}

export interface MeasurementUnit {
  id: number;
  label: I18nText;
  grams_equivalent: number | null;
}

export interface IngredientOption {
  id: number;
  name: I18nText;
  status: 'pending' | 'active';
}

// Une ligne d'ingrédient telle que stockée dans recipe_drafts.ingredients (jsonb)
export interface DraftIngredientLine {
  ingredient_id: number;
  name_fr: string; // dénormalisé pour l'affichage, la source de vérité reste ingredients.name
  is_new: boolean; // true si créé en 'pending' pendant la rédaction de cette recette
  quantity: number | null;
  unit_id: number | null;
}
