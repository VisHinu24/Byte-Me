import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format, parseISO } from 'date-fns';

export function LabTrendChart({ trend }) {
  if (!trend?.points?.length) return null;

  const data = trend.points.map((p) => ({
    at: typeof p.at === 'string' ? parseISO(p.at).getTime() : new Date(p.at).getTime(),
    value: p.value,
    interpretation: p.interpretation,
  }));

  const latest = data[data.length - 1];
  const interp = latest?.interpretation;

  return (
    <div className="rounded-lg border border-clinical-border bg-clinical-bg/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-medium">{trend.display}</div>
          <div className="text-xs text-slate-500">{trend.points.length} readings</div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tabular-nums">
            {latest?.value}
            <span className="text-xs text-slate-400 ml-1">{trend.points[trend.points.length - 1].unit}</span>
          </div>
          {interp && (
            <span
              className={`pill ${
                interp === 'H' ? 'border-clinical-danger/40 text-clinical-danger' :
                interp === 'L' ? 'border-clinical-warn/40 text-clinical-warn' :
                'border-clinical-ok/40 text-clinical-ok'
              }`}
            >
              {interp === 'H' ? 'high' : interp === 'L' ? 'low' : 'normal'}
            </span>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="at"
            type="number"
            domain={['dataMin', 'dataMax']}
            scale="time"
            tickFormatter={(t) => format(t, 'MMM yy')}
            stroke="#475569"
            fontSize={10}
          />
          <YAxis stroke="#475569" fontSize={10} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: '#0b1220', border: '1px solid #1e2a44', borderRadius: 8 }}
            labelFormatter={(t) => format(t, 'd MMM yyyy')}
            formatter={(v) => [v, trend.display]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#5eead4"
            strokeWidth={2}
            dot={{ r: 3, fill: '#5eead4' }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
