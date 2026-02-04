export const ADMIN_ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  SUPPORT: "SUPPORT",
  TECHNICAL: "TECHNICAL",
  ACCOUNTANT: "ACCOUNTANT",
} as const;

export type AdminRoleType = (typeof ADMIN_ROLES)[keyof typeof ADMIN_ROLES];

export const MERCHANT_ROLES = {
  MERCHANT: "MERCHANT",
} as const;

export type MerchantRoleType =
  (typeof MERCHANT_ROLES)[keyof typeof MERCHANT_ROLES];

export const USER_ROLES = {
  ...ADMIN_ROLES,
  ...MERCHANT_ROLES,
} as const;

export type UserRoleType = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const ROLE_CATEGORY = {
  ADMIN: "ADMIN",
  MERCHANT: "MERCHANT",
} as const;

export type RoleCategoryType =
  (typeof ROLE_CATEGORY)[keyof typeof ROLE_CATEGORY];

export function getRoleCategory(role: UserRoleType): RoleCategoryType {
  if (!role) return ROLE_CATEGORY.ADMIN; // safe default

  const value = role.toUpperCase();

  if (Object.values(ADMIN_ROLES).includes(value as AdminRoleType)) {
    return ROLE_CATEGORY.ADMIN;
  }

  if (Object.values(MERCHANT_ROLES).includes(value as MerchantRoleType)) {
    return ROLE_CATEGORY.MERCHANT;
  }

  // fallback (never happens unless data corrupted)
  return ROLE_CATEGORY.ADMIN;
}
