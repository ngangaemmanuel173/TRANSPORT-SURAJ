import { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

type StatCardProps = {
  label: string;
  value: string;
  icon: ReactNode;
  trend?: { value: string; up: boolean };
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'slate';
};

const colorClasses: Record<string, { bg: string; text: string; ring: string }> = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600', ring: 'ring-blue-100' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-100' },
  rose: { bg: 'bg-rose-50', text: 'text-rose-600', ring: 'ring-rose-100' },
  slate: { bg: 'bg-slate-100', text: 'text-slate-600', ring: 'ring-slate-200' },
};

export function StatCard({ label, value, icon, trend, color = 'blue' }: StatCardProps) {
  const c = colorClasses[color];
  return (
    <div className="card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
          {trend && (
            <div className="mt-2 flex items-center gap-1 text-xs">
              {trend.up ? (
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
              )}
              <span className={trend.up ? 'text-emerald-600' : 'text-rose-600'}>
                {trend.value}
              </span>
            </div>
          )}
        </div>
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${c.bg} ${c.text} ring-4 ${c.ring}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}
