export interface TenantThemeView {
  id: string;
  organizationId: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  subdomain: string | null;
  customDomain: string | null;
}

export interface ResolvedTenant {
  id: string;
  name: string;
  slug: string;
  tenantTheme: TenantThemeView | null;
}

export interface TenantCurrentResponse {
  id: string;
  name: string;
  slug: string;
  theme: TenantThemeView | null;
}
