'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@boletera/ui';
import { useCameraCapture } from './useCameraCapture';
import type { ScanSource } from './types';
import styles from './scanner.module.scss';

type Props = {
  onScan: (text: string, source: ScanSource) => void;
  disabled?: boolean;
};

/**
 * Cámara + entrada manual. El MediaStream vive en refs; no se guardan frames
 * en estado React.
 */
export function CameraScanner({ onScan, disabled = false }: Props) {
  const fieldId = useId();
  const [manual, setManual] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleDecode = useCallback(
    (value: string) => {
      if (disabled) return;
      onScan(value, 'camera');
    },
    [disabled, onScan],
  );

  const camera = useCameraCapture({
    onDecode: handleDecode,
    paused: disabled,
  });

  const stop = camera.stop;
  const active = camera.active;

  useEffect(() => {
    if (disabled && active) stop();
  }, [active, disabled, stop]);

  const submitManual = () => {
    const value = manual.trim();
    if (!value || disabled) return;
    onScan(value, 'manual');
    setManual('');
    inputRef.current?.focus();
  };

  const statusLabel = (() => {
    switch (camera.status) {
      case 'requesting':
        return 'Solicitando cámara…';
      case 'running':
        return camera.decoderSupported
          ? 'Cámara activa — apunta al código'
          : 'Cámara activa (sin decodificador automático)';
      case 'denied':
        return 'Cámara bloqueada';
      case 'unsupported':
        return 'Cámara no disponible';
      case 'error':
        return 'Error de cámara';
      default:
        return 'Cámara en espera';
    }
  })();

  return (
    <div className={styles.camera}>
      <div className={styles.cameraActions}>
        <Button
          type="button"
          variant={active ? 'secondary' : 'primary'}
          size="lg"
          onClick={() => (active ? camera.stop() : camera.start())}
          disabled={disabled || camera.status === 'unsupported'}
          aria-pressed={active}
        >
          {active ? 'Detener cámara' : 'Escanear con cámara'}
        </Button>

        {camera.torchAvailable && active ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={camera.toggleTorch}
            aria-pressed={camera.torchOn}
          >
            {camera.torchOn ? 'Apagar linterna' : 'Linterna'}
          </Button>
        ) : null}
      </div>

      {camera.devices.length > 1 ? (
        <label className={styles.manualLabel} htmlFor={`${fieldId}-device`}>
          Cámara
          <select
            id={`${fieldId}-device`}
            className={styles.deviceSelect}
            value={camera.deviceId ?? ''}
            onChange={(event) => camera.selectDevice(event.target.value)}
            disabled={!active}
          >
            {camera.devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className={styles.hint} role="status" aria-live="polite">
        {statusLabel}
      </p>

      {camera.error ? (
        <p className={styles.error} role="alert">
          {camera.error}
        </p>
      ) : null}

      <div className={styles.videoWrap} data-active={active ? 'true' : 'false'}>
        <video
          ref={camera.videoRef}
          className={styles.video}
          playsInline
          muted
          autoPlay
          aria-label="Vista previa de la cámara para escanear códigos"
        />
        {active ? <div className={styles.viewfinder} aria-hidden="true" /> : null}
        {!active ? (
          <p className={styles.videoPlaceholder}>
            Activa la cámara o pega el código abajo. Los fotogramas no se almacenan.
          </p>
        ) : null}
      </div>

      {active && !camera.decoderSupported ? (
        <p className={styles.hint} role="status">
          Este navegador no soporta BarcodeDetector. Usa el campo manual o un lector USB.
        </p>
      ) : null}

      <label className={styles.manualLabel} htmlFor={fieldId}>
        Código manual / lector USB
      </label>
      <textarea
        id={fieldId}
        ref={inputRef}
        className={styles.manualInput}
        value={manual}
        onChange={(event) => setManual(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitManual();
          }
        }}
        placeholder="Código BLT-… o payload JSON del QR"
        rows={3}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      <div className={styles.manualActions}>
        <Button
          type="button"
          size="lg"
          fullWidth
          onClick={submitManual}
          disabled={disabled || !manual.trim()}
          loading={disabled}
          loadingLabel="Validando…"
        >
          Validar entrada
        </Button>
      </div>
    </div>
  );
}
