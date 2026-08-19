/**
 * Configuración del evento único.
 *
 * Este archivo es la ÚNICA fuente de verdad del contenido del home. Cambiar
 * fecha, sede, precios o atracciones se hace aquí — ningún componente lleva
 * texto ni fechas hardcodeadas.
 *
 * ⚠ DATOS POR CONFIRMAR (marcados con TODO): las fechas y los precios de la
 * edición 2026 son marcadores de posición basados en el patrón de 2025
 * (30 oct – 2 nov, 4ª edición). No están confirmados. Cámbialos antes de
 * publicar o el home anunciará fechas falsas.
 */

export type TicketTier = {
  id: string;
  name: string;
  price: number;
  blurb: string;
  perks: string[];
  /**
   * Zona/oferta correspondiente en el evento sembrado — se pasa como
   * `?zone=` a /events/<slug> para preseleccionarla. Debe coincidir con el
   * nombre de zona del inventario real.
   */
  zone?: string;
  featured?: boolean;
  soldOut?: boolean;
};

export type Attraction = {
  id: string;
  name: string;
  blurb: string;
  /** Clave del ícono en `AttractionIcon`. */
  icon: 'pumpkin' | 'ghost' | 'film' | 'axe' | 'ferris' | 'market' | 'paw' | 'flame';
};

export const EVENT = {
  name: 'Pumpkin Zone',
  /**
   * TODO(confirmar): slug del evento sembrado en la base. El CTA de boletos
   * lleva a /events/<slug>, que es donde viven holds, precios y checkout real.
   */
  slug: 'pumpkin-zone-2026',
  edition: '5ª Edición',
  tagline: 'El lugar donde el otoño y Halloween se encuentran',
  intro:
    'Cientos de calabazas reales, luces cálidas y una noche que no se parece a ninguna otra. ' +
    'Puebla vuelve a encender la temporada.',

  // TODO(confirmar): fechas de la edición 2026.
  startsAt: '2026-10-29T11:00:00-06:00',
  endsAt: '2026-11-02T00:00:00-06:00',
  scheduleLabel: '29 oct — 2 nov, 2026',
  hoursLabel: '11:00 am — Medianoche',

  venue: {
    name: 'Downtown Lomas de Angelópolis',
    city: 'Puebla',
    state: 'Puebla',
    /** El organizador comunica sede única cada año — es un mensaje anti-fraude real. */
    exclusivityNote:
      'Sede única. No estamos asociados con eventos de calabazas en otras sedes.',
    mapsUrl: 'https://maps.google.com/?q=Downtown+Lomas+de+Angelopolis+Puebla',
  },

  producers: ['Ricordi', 'Murad Producciones'],

  attractions: [
    {
      id: 'patch',
      name: 'Campo de calabazas',
      blurb: 'Cientos de calabazas reales entre pacas de heno y luces colgantes.',
      icon: 'pumpkin',
    },
    {
      id: 'pasaje',
      name: 'Pasaje Siniestro',
      blurb: 'La casa del terror que todos vienen a contar después.',
      icon: 'ghost',
    },
    {
      id: 'talleres',
      name: 'Talleres de tallado',
      blurb: 'Talla tu calabaza y llévatela. Cuchillo, plantilla y paciencia incluidos.',
      icon: 'flame',
    },
    {
      id: 'cine',
      name: 'Cine al aire libre',
      blurb: 'Clásicos de temporada bajo el cielo de Angelópolis.',
      icon: 'film',
    },
    {
      id: 'juegos',
      name: 'Juegos mecánicos',
      blurb: 'La rueda, las luces y la vista completa del campo desde arriba.',
      icon: 'ferris',
    },
    {
      id: 'hachas',
      name: 'Lanzamiento de hachas',
      blurb: 'Con supervisión, con casco, y con más adrenalina de la que esperas.',
      icon: 'axe',
    },
    {
      id: 'bazar',
      name: 'Bazar de temporada',
      blurb: 'Marcas locales, comida de otoño y cosas que no vas a encontrar en otro lado.',
      icon: 'market',
    },
    {
      id: 'pet',
      name: 'Zona pet friendly',
      blurb: 'Tu perro también trae disfraz. Aquí lo puede presumir.',
      icon: 'paw',
    },
  ] satisfies Attraction[],

  // Un solo tipo de entrada, un solo precio (modelo real del evento: la
  // entrada da acceso al festival; pasaje, talleres y juegos se pagan dentro).
  // Precio 2025 verificado: $50. TODO(confirmar): precio 2026.
  tickets: [
    {
      id: 'general',
      zone: 'General',
      name: 'Entrada General',
      price: 50,
      featured: false,
      blurb:
        'Acceso a todo el festival: campo de calabazas, escenarios fotográficos, ' +
        'bazar, corredor gastronómico, cine al aire libre y shows nocturnos.',
      perks: [
        'Campo con cientos de calabazas reales',
        'Más de 25 escenarios para fotos',
        'Cine al aire libre y shows de fuego',
        'Bazar y corredor gastronómico',
        'Pet friendly (con correa)',
      ],
    },
  ] satisfies TicketTier[],
} as const;

/** Formatea un precio MXN sin decimales — los boletos siempre son cerrados. */
export function formatPrice(pesos: number): string {
  return `$${pesos.toLocaleString('es-MX')}`;
}

export type Slide = {
  id: string;
  title: string;
  caption: string;
  /**
   * Ruta bajo `public/`. Si es `null`, el carrusel dibuja una escena generada
   * con el mismo lenguaje visual — así el home se ve terminado sin assets.
   * Suelta las fotos en `public/pumpkin/` y pon la ruta aquí.
   */
  src: string | null;
  /** Tono de la escena generada cuando no hay foto. */
  scene: 'field' | 'lanterns' | 'passage' | 'carving' | 'night';
};

export const GALLERY: Slide[] = [
  {
    id: 'field',
    title: 'El campo de calabazas',
    caption: 'Cientos de calabazas reales entre pacas de heno, al atardecer.',
    src: '/pumpkin/field.svg',
    scene: 'field',
  },
  {
    id: 'lanterns',
    title: 'Luces de temporada',
    caption: 'Cuando cae la noche, todo el campo se enciende.',
    src: '/pumpkin/lanterns.svg',
    scene: 'lanterns',
  },
  {
    id: 'passage',
    title: 'Pasaje Siniestro',
    caption: 'La casa del terror que todos vienen a contar después.',
    src: '/pumpkin/passage.svg',
    scene: 'passage',
  },
  {
    id: 'carving',
    title: 'Talleres de tallado',
    caption: 'Talla tu calabaza y llévatela a casa.',
    src: '/pumpkin/carving.svg',
    scene: 'carving',
  },
  {
    id: 'night',
    title: 'Shows nocturnos',
    caption: 'Acrobacia, teatro y fuego bajo el cielo de Angelópolis.',
    src: '/pumpkin/night.svg',
    scene: 'night',
  },
];
