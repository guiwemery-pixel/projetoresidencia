import { useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Table2, LineChart as LineIcon } from 'lucide-react';
import { chartTheme, SERIES } from '../../lib/palette';
import { Card, IconButton } from '../ui';

// Specs: linhas de 2px, marcadores 8px com anel da cor da superfície, barras
// de até 24px com ponta arredondada de 4px, grade em linha fina sólida,
// tooltip com valor em destaque e série em segundo plano.

const axisProps = {
  tick: { fill: chartTheme.tick, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: chartTheme.axis },
} as const;

type Fmt = (v: number) => string;

interface TipProps {
  active?: boolean;
  payload?: { dataKey?: unknown; value?: unknown; name?: unknown; color?: string }[];
  label?: unknown;
  fmt?: Fmt;
  labelFmt?: (l: string) => string;
}

function ChartTooltip({ active, payload, label, fmt: formatter, labelFmt: labelFormatter }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1 text-muted">{labelFormatter ? labelFormatter(String(label)) : String(label ?? '')}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: p.color }} />
          <strong className="num text-ink">{p.value === null || p.value === undefined ? '—' : formatter ? formatter(Number(p.value)) : String(p.value)}</strong>
          <span className="text-ink2">{String(p.name ?? '')}</span>
        </p>
      ))}
    </div>
  );
}

export interface SeriesDef {
  key: string;
  name: string;
}

/** Cartão de gráfico com alternância para visualização em tabela. */
export function ChartCard({
  title,
  subtitle,
  children,
  table,
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  action?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card
      title={title}
      subtitle={subtitle}
      action={
        <div className="flex items-center gap-1">
          {action}
          <IconButton label={asTable ? 'Ver gráfico' : 'Ver tabela'} onClick={() => setAsTable((v) => !v)}>
            {asTable ? <LineIcon className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
          </IconButton>
        </div>
      }
    >
      {asTable ? (
        <div className="max-h-72 overflow-auto">
          <table className="num w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface text-xs text-muted">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="py-1.5 pr-4 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((c, j) => (
                    <td key={j} className="py-1.5 pr-4 text-ink">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

export function TrendLine({
  data,
  xKey,
  series,
  formatter,
  xFormatter,
  yDomain,
  height = 220,
  area,
  legend,
}: {
  data: object[];
  xKey: string;
  series: SeriesDef[];
  formatter?: Fmt;
  xFormatter?: (v: string) => string;
  yDomain?: [number | 'auto', number | 'auto'];
  height?: number;
  area?: boolean;
  legend?: boolean;
}) {
  const common = (
    <>
      <CartesianGrid vertical={false} stroke={chartTheme.grid} strokeWidth={1} />
      <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter} minTickGap={16} />
      <YAxis {...axisProps} axisLine={false} width={40} domain={yDomain} tickFormatter={formatter} />
      <Tooltip
        cursor={{ stroke: chartTheme.axis, strokeWidth: 1 }}
        content={(props) => <ChartTooltip {...(props as unknown as TipProps)} fmt={formatter} labelFmt={xFormatter} />}
      />
      {legend && series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: 'var(--ink-2)' }} />}
    </>
  );
  if (area && series.length === 1) {
    const s = series[0];
    return (
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {common}
          <Area
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={SERIES[0]}
            strokeWidth={2}
            fill={SERIES[0]}
            fillOpacity={0.1}
            connectNulls
            animationDuration={500}
            dot={false}
            activeDot={{ r: 4, stroke: chartTheme.surface, strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        {common}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={SERIES[i % SERIES.length]}
            strokeWidth={2}
            strokeLinecap="round"
            connectNulls
            animationDuration={500}
            dot={{ r: 4, fill: SERIES[i % SERIES.length], stroke: chartTheme.surface, strokeWidth: 2 }}
            activeDot={{ r: 5, stroke: chartTheme.surface, strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Columns({
  data,
  xKey,
  yKey,
  name,
  formatter,
  xFormatter,
  height = 220,
}: {
  data: object[];
  xKey: string;
  yKey: string;
  name: string;
  formatter?: Fmt;
  xFormatter?: (v: string) => string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={chartTheme.grid} />
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormatter} minTickGap={8} />
        <YAxis {...axisProps} axisLine={false} width={40} tickFormatter={formatter} allowDecimals={false} />
        <Tooltip cursor={{ fill: 'var(--subtle)' }} content={(props) => <ChartTooltip {...(props as unknown as TipProps)} fmt={formatter} labelFmt={xFormatter} />} />
        <Bar dataKey={yKey} name={name} fill={SERIES[0]} maxBarSize={24} radius={[4, 4, 0, 0]} animationDuration={500} />
      </BarChart>
    </ResponsiveContainer>
  );
}
