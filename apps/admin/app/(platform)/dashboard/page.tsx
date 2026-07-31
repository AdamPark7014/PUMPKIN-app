'use client';

import { useMemo, useState } from 'react';
import { RealtimeDashboardPanel } from '@/components/RealtimeDashboardPanel';
import { ActivityPanel } from './_components/ActivityPanel';
import { AlertsPanel } from './_components/AlertsPanel';
import { ChannelsPanel } from './_components/ChannelsPanel';
import { DashboardHeader } from './_components/DashboardHeader';
import { ErrorBanner } from './_components/ErrorBanner';
import { KpiStrip } from './_components/KpiStrip';
import { PacePanel } from './_components/PacePanel';
import { Panel } from './_components/Panel';
import { ProjectionStrip } from './_components/ProjectionStrip';
import { SeriesPanel } from './_components/SeriesPanel';
import { useDashboardData } from './_lib/use-dashboard-data';
import type { DashboardMetric } from './_lib/derive';
import { buildDashboardRange, type DashboardRangeKey } from './range';
import styles from './dashboard.module.scss';

export default function DashboardPage() {
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>('7d');
  const [metric, setMetric] = useState<DashboardMetric>('revenue');
  const range = useMemo(() => buildDashboardRange(rangeKey), [rangeKey]);

  const data = useDashboardData(range, metric);

  return (
    <div className={styles.wrap}>
      <DashboardHeader
        range={range}
        onRangeChange={setRangeKey}
        generatedAt={data.generatedAt}
        isRefreshing={data.isRefreshing}
        onRefresh={data.refetchAll}
      />

      <ErrorBanner failures={data.failures} onRetry={data.refetchAll} />

      <KpiStrip
        kpis={data.executive.data?.kpis}
        trends={data.trends}
        comparisonLabel={range.comparisonLabel}
        loading={data.executive.isPending}
      />

      <ProjectionStrip projection={data.executive.data?.projection} />

      <SeriesPanel
        range={range}
        metric={metric}
        onMetricChange={setMetric}
        current={data.chartData}
        previous={data.comparisonData}
        stats={data.stats}
        comparisonStats={data.comparisonStats}
        loading={data.chartQuery.isPending}
        error={data.chartQuery.error}
        onRetry={() => void data.chartQuery.refetch()}
      />

      <Panel
        headingId="live-heading"
        title="Pulso en tiempo real"
        description="SSE con respaldo por sondeo cada 10 s"
      >
        <RealtimeDashboardPanel />
      </Panel>

      <div className={styles.twoCol}>
        <PacePanel
          data={data.salesPace.data}
          loading={data.salesPace.isPending}
          error={data.salesPace.error}
          onRetry={() => void data.salesPace.refetch()}
        />
        <ChannelsPanel
          breakdown={data.executive.data?.revenueByChannel}
          loading={data.executive.isPending}
          error={data.executive.error}
          onRetry={() => void data.executive.refetch()}
        />
      </div>

      <div className={styles.twoCol}>
        <AlertsPanel
          data={data.alerts.data}
          loading={data.alerts.isPending}
          error={data.alerts.error}
          onRetry={() => void data.alerts.refetch()}
        />
        <ActivityPanel
          overview={data.overview.data}
          loading={data.overview.isPending}
          error={data.overview.error}
          onRetry={() => void data.overview.refetch()}
        />
      </div>
    </div>
  );
}
