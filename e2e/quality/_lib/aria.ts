/**
 * Utilidades sobre el árbol de accesibilidad que expone Playwright con
 * `locator.ariaSnapshot()`.
 *
 * Se usa el snapshot ARIA en lugar de una implementación propia de
 * accessible-name porque el nombre lo calcula el mismo motor que usan los
 * lectores de pantalla (accname 1.2), y porque el snapshot sólo contiene nodos
 * expuestos: lo oculto con `aria-hidden`, `display:none` o `hidden` no genera
 * falsos positivos.
 */

export type AriaNode = {
  readonly role: string;
  /** Nombre accesible calculado por Playwright, o `null` si no tiene. */
  readonly name: string | null;
  readonly attributes: Readonly<Record<string, string>>;
  /** Cadena de ancestros `rol "nombre"` desde la raíz, útil como evidencia. */
  readonly path: readonly string[];
};

const NODE_LINE =
  /^(?<indent>\s*)- (?<role>[a-zA-Z][a-zA-Z0-9-]*)(?<rest>[^\n]*)$/;
const NAME_PART = /^\s+"(?<name>(?:[^"\\]|\\.)*)"/;
const ATTRIBUTE_PART = /\[([a-zA-Z][a-zA-Z0-9-]*)(?:=([^\]]*))?\]/g;

function unescapeName(raw: string): string {
  return raw.replace(/\\(.)/g, '$1');
}

function describe(role: string, name: string | null): string {
  return name === null ? role : `${role} "${name}"`;
}

/**
 * Convierte el YAML del snapshot ARIA en una lista plana de nodos.
 * Las líneas de propiedad (`- /url: ...`) y el texto suelto se ignoran.
 */
export function parseAriaSnapshot(snapshot: string): readonly AriaNode[] {
  const nodes: AriaNode[] = [];
  const stack: { indent: number; label: string }[] = [];

  for (const line of snapshot.split('\n')) {
    if (line.trim().length === 0) continue;
    const match = NODE_LINE.exec(line);
    if (!match?.groups) continue;

    const indent = match.groups['indent']?.length ?? 0;
    const role = match.groups['role'] ?? '';
    let rest = match.groups['rest'] ?? '';

    // `- text: hola` es contenido, no un rol ARIA.
    // `- navigation:` (solo `:`) es un landmark con hijos; el `:` YAML se ignora.
    if (role.length === 0 || role === 'text') continue;
    if (/^:\s*$/.test(rest)) rest = '';
    else if (rest.startsWith(':')) continue;

    const nameMatch = NAME_PART.exec(rest);
    const name =
      nameMatch?.groups?.['name'] !== undefined
        ? unescapeName(nameMatch.groups['name'])
        : null;

    const attributes: Record<string, string> = {};
    ATTRIBUTE_PART.lastIndex = 0;
    let attribute = ATTRIBUTE_PART.exec(rest);
    while (attribute !== null) {
      const key = attribute[1];
      if (key !== undefined) attributes[key] = attribute[2] ?? 'true';
      attribute = ATTRIBUTE_PART.exec(rest);
    }

    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) {
      stack.pop();
    }

    nodes.push({
      role,
      name,
      attributes,
      path: stack.map((entry) => entry.label),
    });
    stack.push({ indent, label: describe(role, name) });
  }

  return nodes;
}

/** Roles que la WCAG 4.1.2 obliga a exponer con nombre accesible. */
export const ROLES_REQUIRING_NAME: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'combobox',
  'img',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
]);

export const LANDMARK_ROLES: ReadonlySet<string> = new Set([
  'banner',
  'complementary',
  'contentinfo',
  'form',
  'main',
  'navigation',
  'region',
  'search',
]);

export function nodeEvidence(node: AriaNode): string {
  const location = node.path.length > 0 ? node.path.join(' > ') : '(raíz)';
  return `${describe(node.role, node.name)} — dentro de ${location}`;
}

export function headingLevel(node: AriaNode): number | null {
  const raw = node.attributes['level'];
  if (raw === undefined) return null;
  const level = Number.parseInt(raw, 10);
  return Number.isFinite(level) ? level : null;
}
