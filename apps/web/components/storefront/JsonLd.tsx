import { jsonLdString, type JsonLdObject } from '@/lib/seo';

/**
 * Inserta datos estructurados schema.org. Es un Server Component: el JSON
 * viaja en el HTML inicial sin costo de JavaScript en el cliente.
 */
export function JsonLd({ data }: { data: JsonLdObject | readonly JsonLdObject[] }) {
  const nodes = Array.isArray(data) ? data : [data as JsonLdObject];
  return (
    <>
      {nodes.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(node) }}
        />
      ))}
    </>
  );
}
