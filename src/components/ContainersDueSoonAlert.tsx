import { useEffect, useState } from 'react';
import { Package, AlertTriangle, ChevronRight } from 'lucide-react';
import { supabase, getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { SubAccount, MCLArea } from '@/lib/portals';

interface DueContainer {
  id: string;
  container_no: string;
  vehicle_id: string | null;
  detention_validity: string;
  sub_account: string;
  vehicle?: { plate_number: string } | null;
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function ContainersDueSoonAlert({
  mclArea,
  portalColor,
  onViewAll,
  subAccountProp,
}: {
  mclArea: MCLArea | null;
  portalColor: string;
  onViewAll: () => void;
  subAccountProp?: string;
}) {
  const { profile } = useAuth();
  
  // Detect sub-account dynamically from props or URL path
  const pathSegments = window.location.pathname.split('/').filter(Boolean);
  let activeSubAccount = subAccountProp;
  if (!activeSubAccount && pathSegments.length >= 2 && pathSegments[0] === 'admin') {
    activeSubAccount = pathSegments[1];
  }

  const subAccount = (activeSubAccount ?? profile?.sub_account ?? getSubAccountFilter() ?? 'master') as SubAccount;
  const isMCL = subAccount === 'mcl';
  const [dueContainers, setDueContainers] = useState<DueContainer[]>([]);

  useEffect(() => {
    async function load() {
      let query = supabase
        .from('sub_account_containers')
        .select('id, container_no, vehicle_id, detention_validity, sub_account, vehicle:vehicles(plate_number)')
        .eq('status', 'active')
        .not('detention_validity', 'is', null);

      if (subAccount && subAccount !== 'master' && subAccount !== 'all') {
        query = query.eq('sub_account', subAccount);
      }

      const { data } = await query;
      let items = (data as unknown as DueContainer[]) || [];

      if (isMCL && mclArea) {
        items = items.filter((c: any) => c.mcl_area_id === mclArea);
      }

      const filtered = items.filter(c => {
        if (!c.detention_validity) return false;
        const d = daysUntil(c.detention_validity);
        return d <= 3;
      });
      setDueContainers(filtered);
    }
    load();
  }, [subAccount, isMCL, mclArea]);

  if (dueContainers.length === 0) return null;

  return (
    <div className="card p-5 border-amber-200 bg-amber-50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h3 className="text-base font-semibold text-slate-900">Containers Due Soon</h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-200 text-amber-800">
            {dueContainers.length}
          </span>
        </div>
        <button
          onClick={onViewAll}
          className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
        >
          View all containers
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-2">
        {dueContainers.slice(0, 5).map(c => {
          const d = daysUntil(c.detention_validity);
          const isOverdue = d < 0;
          return (
            <div key={c.id} className="flex items-center justify-between rounded-lg bg-white border border-amber-100 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Package className="h-4 w-4 text-slate-400" />
                <div>
                  <p className="text-sm font-medium text-slate-800">{c.container_no}</p>
                  <p className="text-xs text-slate-500">{c.vehicle?.plate_number || 'No truck assigned'}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>
                  {isOverdue ? `${Math.abs(d)} days overdue` : `${d} day${d !== 1 ? 's' : ''} remaining`}
                </p>
                <p className="text-xs text-slate-400">{c.detention_validity}</p>
              </div>
            </div>
          );
        })}
        {dueContainers.length > 5 && (
          <button
            onClick={onViewAll}
            className="text-sm text-slate-500 hover:text-slate-700 font-medium pl-1"
          >
            +{dueContainers.length - 5} more...
          </button>
        )}
      </div>
    </div>
  );
}
