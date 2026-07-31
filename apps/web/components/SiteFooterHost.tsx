import { apiCachedSafe, REVALIDATE } from '@/lib/api';
import type { DiscoveryFacets } from '@/lib/storefront-types';
import { SiteFooter } from './SiteFooter';

/** Carga facetas en el servidor y alimenta el footer del layout. */
export async function SiteFooterHost() {
  const facets = await apiCachedSafe<DiscoveryFacets>(
    '/discovery/facets',
    REVALIDATE.facets,
    ['discovery-facets'],
  );
  return <SiteFooter cities={facets?.cities?.slice(0, 8) ?? []} />;
}
