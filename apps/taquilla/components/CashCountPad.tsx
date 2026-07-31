'use client';

import { useMemo, useState } from 'react';
import {
  bumpDenom,
  denomLabel,
  emptyDenomCounts,
  MXN_DENOMS_CENTAVOS,
  setDenomCount,
  totalFromDenomCounts,
  type DenomCounts,
} from '../app/corte/_lib/denoms';
import {
  formatMxn,
  parseMoneyInput,
  pesosFromCentavos,
} from '../app/corte/_lib/format';
import styles from './CashCountPad.module.scss';

type CountMode = 'pad' | 'denoms';

export type CashCountPadProps = {
  value: string;
  onChange: (nextPesos: string) => void;
  disabled?: boolean;
  expectedPesos?: number;
  id?: string;
};

function appendDigit(current: string, digit: string): string {
  if (digit === '.') {
    if (!current) return '0.';
    if (current.includes('.')) return current;
    return `${current}.`;
  }
  if (!current || current === '0') return digit;
  const [, frac = ''] = current.split('.');
  if (current.includes('.') && frac.length >= 2) return current;
  return `${current}${digit}`;
}

function backspace(current: string): string {
  if (!current) return '';
  return current.slice(0, -1);
}

export function CashCountPad({
  value,
  onChange,
  disabled = false,
  expectedPesos,
  id,
}: CashCountPadProps) {
  const [mode, setMode] = useState<CountMode>('pad');
  const [denoms, setDenoms] = useState<DenomCounts>(() => emptyDenomCounts());

  const parsed = useMemo(() => parseMoneyInput(value), [value]);
  const display = value.trim() === '' ? '0.00' : value;

  function applyDenomTotal(next: DenomCounts) {
    setDenoms(next);
    const total = totalFromDenomCounts(next);
    onChange(pesosFromCentavos(total).toFixed(2));
  }

  function setExactExpected() {
    if (expectedPesos == null || !Number.isFinite(expectedPesos)) return;
    onChange(expectedPesos.toFixed(2));
    setDenoms(emptyDenomCounts());
  }

  return (
    <div className={styles.pad} data-disabled={disabled ? 'true' : 'false'}>
      <div className={styles.displayRow}>
        <div className={styles.display} aria-live="polite">
          <span className={styles.displayLabel}>Contado</span>
          <strong>{formatMxn(parsed ?? 0n)}</strong>
          <label className={styles.typedInput}>
            <span className={styles.visuallyHidden}>Captura numérica</span>
            <input
              id={id}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
              value={value}
              placeholder="0.00"
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d.]/g, '');
                const parts = next.split('.');
                const normalized =
                  parts.length <= 1
                    ? next
                    : `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`;
                onChange(normalized);
                setDenoms(emptyDenomCounts());
              }}
            />
          </label>
          <span className={styles.displayRaw}>{display}</span>
        </div>
        <div className={styles.modeSwitch} role="group" aria-label="Modo de conteo">
          <button
            type="button"
            className={mode === 'pad' ? styles.modeActive : styles.modeBtn}
            disabled={disabled}
            onClick={() => setMode('pad')}
          >
            Teclado
          </button>
          <button
            type="button"
            className={mode === 'denoms' ? styles.modeActive : styles.modeBtn}
            disabled={disabled}
            onClick={() => setMode('denoms')}
          >
            Denominaciones
          </button>
        </div>
      </div>

      {mode === 'pad' ? (
        <div className={styles.keys} role="group" aria-label="Teclado numérico de efectivo">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((key) => (
            <button
              key={key}
              type="button"
              className={key === '⌫' ? styles.keyWide : styles.key}
              disabled={disabled}
              onClick={() => {
                if (key === '⌫') {
                  onChange(backspace(value));
                  return;
                }
                onChange(appendDigit(value, key));
              }}
            >
              {key}
            </button>
          ))}
          <button
            type="button"
            className={styles.keyAction}
            disabled={disabled}
            onClick={() => {
              onChange('');
              setDenoms(emptyDenomCounts());
            }}
          >
            Limpiar
          </button>
          <button
            type="button"
            className={styles.keyAction}
            disabled={disabled || expectedPesos == null}
            onClick={setExactExpected}
          >
            = Esperado
          </button>
        </div>
      ) : (
        <ul className={styles.denomList}>
          {MXN_DENOMS_CENTAVOS.map((denom) => {
            const key = denom.toString();
            const count = denoms[key] ?? 0;
            return (
              <li key={key}>
                <span className={styles.denomLabel}>{denomLabel(denom)}</span>
                <div className={styles.denomControls}>
                  <button
                    type="button"
                    disabled={disabled || count <= 0}
                    aria-label={`Restar ${denomLabel(denom)}`}
                    onClick={() => applyDenomTotal(bumpDenom(denoms, key, -1))}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={count}
                    disabled={disabled}
                    aria-label={`Cantidad de ${denomLabel(denom)}`}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      applyDenomTotal(setDenomCount(denoms, key, n));
                    }}
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`Sumar ${denomLabel(denom)}`}
                    onClick={() => applyDenomTotal(bumpDenom(denoms, key, 1))}
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
