import styles from './DiscoverySkeleton.module.scss';

export function DiscoverySkeleton() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-label="Cargando cartelera">
      <div className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.lineSm} />
          <span className={styles.lineLg} />
          <span className={styles.lineMd} />
          <span className={styles.cta} />
        </div>
      </div>
      <div className={styles.shell}>
        <div className={styles.search} />
        <div className={styles.hubs}>
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={styles.hub} />
          ))}
        </div>
        <div className={styles.listHead}>
          <span className={styles.lineMd} />
          <span className={styles.lineSm} />
        </div>
        <ul className={styles.grid}>
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className={styles.card}>
              <span className={styles.poster} />
              <span className={styles.lineMd} />
              <span className={styles.lineSm} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
