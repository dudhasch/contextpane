import { EntityTypeSchema } from "@contextpane/catalog";

export type EntityType = (typeof EntityTypeSchema.options)[number];

/**
 * Model-written `affectedEntities[].type` values are free text ("User account", "NSG rule"); the
 * drawer schema takes the catalog enum only. Known types pass through, anything else maps by keyword,
 * and the fallback is `resource` so a remediation bundle is never rejected for its entity labels.
 */
export function coerceAffectedEntityType<T extends { type: string }>(entity: T): T & { type: EntityType } {
  if (EntityTypeSchema.safeParse(entity.type).success) return entity as T & { type: EntityType };
  const raw = entity.type.toLowerCase();
  const type: EntityType = /user|upn|account|identity|person/.test(raw)
    ? "upn"
    : /group/.test(raw)
      ? "group"
      : /device|endpoint/.test(raw)
        ? "device"
        : /policy|rule/.test(raw)
          ? "policy"
          : /sku|licen/.test(raw)
            ? "sku"
            : /setting|config/.test(raw)
              ? "setting"
              : "resource";
  return { ...entity, type };
}
