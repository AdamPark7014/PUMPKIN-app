'use client';

import { useCallback, useState } from 'react';
import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import styles from './SeatMapEditor.module.scss';

type Props = {
  initial: SeatMapData;
  onSave: (map: SeatMapData) => Promise<void>;
  onAiSuggest?: (description: string) => Promise<SeatMapSection[]>;
};

const TIERS = ['standard', 'premium', 'economy'] as const;

export function SeatMapEditor({ initial, onSave, onAiSuggest }: Props) {
  const [map, setMap] = useState<SeatMapData>(initial);
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('Arena 500 asientos, 2 secciones, escenario al norte');
  const [activeSection, setActiveSection] = useState(0);
  const [dragging, setDragging] = useState<{
    seatId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const section = map.sections[activeSection];

  function moveSeat(seatId: string, dx: number, dy: number) {
    if (!section) return;
    const sections = [...map.sections];
    sections[activeSection] = {
      ...section,
      seats: section.seats.map((s) =>
        s.id === seatId ? { ...s, x: Math.round(s.x + dx), y: Math.round(s.y + dy) } : s,
      ),
    };
    setMap({ ...map, sections });
  }

  const toggleSeat = useCallback((seatId: string, shiftKey?: boolean) => {
    setSelected((prev) => {
      if (shiftKey) {
        return prev.includes(seatId) ? prev : [...prev, seatId];
      }
      return prev.includes(seatId) ? prev.filter((id) => id !== seatId) : [...prev, seatId];
    });
  }, []);

  function addSection() {
    const idx = map.sections.length;
    setMap({
      ...map,
      sections: [
        ...map.sections,
        {
          id: `sec-${Date.now()}`,
          name: `Sección ${String.fromCharCode(65 + idx)}`,
          slug: `section-${idx}`,
          color: '#737373',
          seats: [],
        },
      ],
    });
    setActiveSection(map.sections.length);
  }

  function addRow(cols = 10) {
    if (!section) return;
    const rowLabel = String.fromCharCode(65 + Math.floor(section.seats.length / cols));
    const startY = 60 + Math.floor(section.seats.length / cols) * 32;
    const newSeats = Array.from({ length: cols }, (_, i) => ({
      id: `seat-${Date.now()}-${i}`,
      label: `${rowLabel}-${i + 1}`,
      row: rowLabel,
      x: 40 + i * 34,
      y: startY,
      tier: 'standard' as const,
    }));
    const sections = [...map.sections];
    sections[activeSection] = { ...section, seats: [...section.seats, ...newSeats] };
    setMap({ ...map, sections });
  }

  function deleteSelected() {
    if (!selected.length || !section) return;
    const sections = [...map.sections];
    sections[activeSection] = {
      ...section,
      seats: section.seats.filter((s) => !selected.includes(s.id)),
    };
    setMap({ ...map, sections });
    setSelected([]);
  }

  function applyTier(tier: (typeof TIERS)[number]) {
    if (!section || !selected.length) return;
    const sections = [...map.sections];
    sections[activeSection] = {
      ...section,
      seats: section.seats.map((s) =>
        selected.includes(s.id) ? { ...s, tier } : s,
      ),
    };
    setMap({ ...map, sections });
  }

  function setSectionColor(color: string) {
    if (!section) return;
    const sections = [...map.sections];
    sections[activeSection] = { ...section, color };
    setMap({ ...map, sections });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(map);
    } finally {
      setSaving(false);
    }
  }

  async function handleAi() {
    if (!onAiSuggest) return;
    const sections = await onAiSuggest(aiPrompt);
    setMap({ ...map, sections });
    setActiveSection(0);
  }

  const w = map.viewport?.width ?? 800;
  const h = map.viewport?.height ?? 500;

  const tierColor = (tier?: string) => {
    if (tier === 'premium') return '#102a43';
    if (tier === 'economy') return '#a3a3a3';
    return section?.color || '#737373';
  };

  return (
    <div className={styles.editor}>
      <div>
        <div className={styles.toolbar}>
          <button type="button" onClick={addSection}>
            + Sección
          </button>
          <button type="button" onClick={() => addRow(12)} disabled={!section}>
            + Fila (12)
          </button>
          <button type="button" onClick={deleteSelected} disabled={!selected.length}>
            Eliminar ({selected.length})
          </button>
          {TIERS.map((t) => (
            <button key={t} type="button" onClick={() => applyTier(t)} disabled={!selected.length}>
              Tier {t}
            </button>
          ))}
          {section && (
            <label className={styles.colorPick}>
              Color
              <input
                type="color"
                value={section.color || '#737373'}
                onChange={(e) => setSectionColor(e.target.value)}
              />
            </label>
          )}
          <button type="button" onClick={handleSave} disabled={saving} className={styles.primary}>
            {saving ? 'Guardando…' : 'Guardar mapa'}
          </button>
        </div>
        {onAiSuggest && (
          <div className={styles.ai}>
            <input value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Describe el venue…" />
            <button type="button" onClick={handleAi}>
              IA: sugerir layout
            </button>
          </div>
        )}
      </div>

      <div className={styles.sectionTabs}>
        {map.sections.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={i === activeSection ? styles.tabActive : ''}
            onClick={() => {
              setActiveSection(i);
              setSelected([]);
            }}
          >
            {s.name} ({s.seats.length})
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={styles.canvas}
        onMouseMove={(e) => {
          if (!dragging) return;
          const svg = e.currentTarget;
          const pt = svg.createSVGPoint();
          pt.x = e.clientX;
          pt.y = e.clientY;
          const ctm = svg.getScreenCTM();
          if (!ctm) return;
          const loc = pt.matrixTransform(ctm.inverse());
          moveSeat(dragging.seatId, loc.x - dragging.startX, loc.y - dragging.startY);
          setDragging({ ...dragging, startX: loc.x, startY: loc.y });
        }}
        onMouseUp={() => setDragging(null)}
        onMouseLeave={() => setDragging(null)}
      >
        <rect x={w / 2 - 80} y={10} width={160} height={36} rx={4} fill="#171717" />
        <text x={w / 2} y={32} textAnchor="middle" fill="#fff" fontSize={12}>
          ESCENARIO
        </text>
        {section?.seats.map((seat) => (
          <circle
            key={seat.id}
            cx={seat.x}
            cy={seat.y}
            r={10}
            fill={selected.includes(seat.id) ? '#486581' : tierColor(seat.tier)}
            stroke={selected.includes(seat.id) ? '#102a43' : '#fff'}
            strokeWidth={selected.includes(seat.id) ? 2 : 1}
            className={styles.seat}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              const svg = e.currentTarget.ownerSVGElement;
              if (!svg) return;
              const pt = svg.createSVGPoint();
              pt.x = e.clientX;
              pt.y = e.clientY;
              const ctm = svg.getScreenCTM();
              if (!ctm) return;
              const loc = pt.matrixTransform(ctm.inverse());
              setDragging({ seatId: seat.id, startX: loc.x, startY: loc.y, origX: seat.x, origY: seat.y });
            }}
            onClick={(e) => {
              if (dragging) return;
              toggleSeat(seat.id, e.shiftKey);
            }}
          />
        ))}
      </svg>
      <p className={styles.hint}>
        {section
          ? `${section.seats.length} asientos · arrastra para mover · Shift+clic multi-selección`
          : 'Agrega una sección'}
        {selected.length > 0 && ` · ${selected.length} seleccionados`}
      </p>
    </div>
  );
}
