/**
 * Règles de délégation des droits entre jetons.
 *
 * Un jeton « gestionnaire » (permissions.manage) peut créer et gérer des jetons
 * enfants, à une condition : un enfant ne peut jamais avoir plus de pouvoir que
 * son créateur. Fonctions pures, sans accès base, pour être testables seules.
 */

export interface TokenPermissions {
  read: boolean;
  write: boolean;
  delete: boolean;
  /** Peut créer / modifier / révoquer les jetons qu'il a lui-même créés. */
  manage: boolean;
}

export interface TokenPolicy {
  permissions: TokenPermissions;
  allowedFolderIds: string[];
  deniedTagIds: string[];
  autoTagId: string | null;
}

export interface ParentLimits {
  permissions: TokenPermissions;
  /** Dossiers accessibles au gestionnaire (sous-dossiers inclus) ; null = tous. */
  folderScope: string[] | null;
  deniedTagIds: string[];
}

/** Nombre maximal de jetons enfants par gestionnaire (freine un emballement). */
export const MAX_CHILD_TOKENS = 50;

/** Lit la colonne JSON des droits ; un jeton antérieur à la migration n'a ni « manage » ni « delete ». */
export function normalizePermissions(raw: unknown): TokenPermissions {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return { read: p.read !== false, write: p.write !== false, delete: p.delete === true, manage: p.manage === true };
}

/** Cohérence interne d'une politique, valable pour tout créateur (session comprise). */
export function validatePolicy(policy: TokenPolicy): string | null {
  if (policy.autoTagId && policy.deniedTagIds.includes(policy.autoTagId)) {
    return 'Le tag automatique ne peut pas être un tag interdit';
  }
  return null;
}

/** Vérifie qu'un jeton enfant reste dans les limites de son gestionnaire. null = autorisé. */
export function validateChildPolicy(parent: ParentLimits, child: TokenPolicy): string | null {
  const own = validatePolicy(child);
  if (own) return own;
  if (child.permissions.manage) return 'Un jeton gestionnaire ne peut pas créer un autre gestionnaire';
  for (const key of ['read', 'write', 'delete'] as const) {
    if (child.permissions[key] && !parent.permissions[key]) {
      return `Le jeton gestionnaire n'a pas le droit « ${key} », il ne peut pas l'accorder`;
    }
  }
  const scope = parent.folderScope;
  if (scope !== null) {
    if (child.allowedFolderIds.length === 0) {
      return 'Le jeton gestionnaire est limité à des dossiers : chaque jeton créé doit l\'être aussi';
    }
    if (child.allowedFolderIds.some((id) => !scope.includes(id))) {
      return 'Dossier hors du périmètre du jeton gestionnaire';
    }
  }
  if (parent.deniedTagIds.some((tag) => !child.deniedTagIds.includes(tag))) {
    return 'Les tags interdits au jeton gestionnaire doivent rester interdits à ses jetons';
  }
  return null;
}
