import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_RECIPE, DEFAULT_RECIPE_ID, ViewRecipeSchema, type ViewRecipe } from "@contextpane/catalog";
import { config } from "../config.ts";

/**
 * View Recipes persisted to data/recipes.json. The default recipe is always
 * available and never written unless the user edits it.
 */
class RecipeStore {
  private file = join(config.dataDir, "recipes.json");
  private recipes = new Map<string, ViewRecipe>();
  private loaded = false;

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    this.recipes.set(DEFAULT_RECIPE_ID, DEFAULT_RECIPE);
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as unknown;
      const list = Array.isArray(raw) ? raw : [];
      for (const item of list) {
        const parsed = ViewRecipeSchema.safeParse(item);
        if (parsed.success) this.recipes.set(parsed.data.recipeId, parsed.data);
        else console.warn(`[recipes] skipping invalid recipe in ${this.file}`);
      }
    } catch (error) {
      console.warn(`[recipes] could not read ${this.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persist() {
    mkdirSync(config.dataDir, { recursive: true });
    const list = [...this.recipes.values()].filter((r) => r.recipeId !== DEFAULT_RECIPE_ID || r !== DEFAULT_RECIPE);
    writeFileSync(this.file, JSON.stringify(list, null, 2) + "\n", "utf8");
  }

  list(): ViewRecipe[] {
    this.load();
    return [...this.recipes.values()].sort((a, b) => (a.recipeId === DEFAULT_RECIPE_ID ? -1 : b.recipeId === DEFAULT_RECIPE_ID ? 1 : a.updatedAt.localeCompare(b.updatedAt)));
  }

  get(recipeId: string): ViewRecipe | null {
    this.load();
    return this.recipes.get(recipeId) ?? null;
  }

  save(input: Omit<ViewRecipe, "createdAt" | "updatedAt"> & Partial<Pick<ViewRecipe, "createdAt" | "updatedAt">>): ViewRecipe {
    this.load();
    const now = new Date().toISOString();
    const existing = this.recipes.get(input.recipeId);
    const recipe = ViewRecipeSchema.parse({
      ...input,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: now,
    });
    this.recipes.set(recipe.recipeId, recipe);
    this.persist();
    return recipe;
  }

  delete(recipeId: string): boolean {
    this.load();
    if (recipeId === DEFAULT_RECIPE_ID) return false;
    const removed = this.recipes.delete(recipeId);
    if (removed) this.persist();
    return removed;
  }

  path(): string {
    return this.file;
  }
}

export const recipeStore = new RecipeStore();

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "recipe";
}
