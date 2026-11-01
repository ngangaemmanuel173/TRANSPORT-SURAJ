import { useEffect, useState, useCallback } from 'react';
import { UserCheck, AlertTriangle, Bell, Edit, Upload } from 'lucide-react';
import { supabase, getSubAccountFilter } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/PageHeader';
import { Modal } from '@/components/Modal';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { BulkImportModal } from '@/components/BulkImportModal';
import { SubAccount } from '@/lib/portals';

interface DriverComplianceRecord {
  id: string;
  driver_id: string;
  driver?: { name: string; phone: string };
  license_start: string;
  license_expiry: string;
  compliance_start: string;
  compliance_expiry: string;
  atic_insurance_start: string;
  atic_insurance_expiry: string;
}

function getExpiryStatus(expiryDateStr: string) {
  if (!expiryDateStr) return 'ok';
  const today = new Date();
  const expiry = new Date(expiryDateStr);
  const diffTime = expiry.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'expired';
  if (diffDays <= 14) return 'warning-2w';
  if (diffDays <= 30) return 'warning-1m';
  return 'ok';
}

function StatusBadge({ date }: { date: string }) {
  const status = getExpiryStatus(date);
  if (!date) return <span className="text-slate-300">—</span>;

  if (status === 'expired') {
    return <span className="badge-danger flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Expired ({date})</span>;
  }
  if (status === 'warning-2w') {
    return <span className="badge-danger flex items-center gap-1"><Bell className="h-3 w-3" /> Expiring in &lt;2 wks ({date})</span>;
  }
  if (status === 'warning-1m') {
    return <span className="badge-warning flex items-center gap-1"><Bell className="h-3 w-3" /> Expiring in &lt;1 mo ({date})</span>;
  }
  return <span className="badge-success">{date}</span>;
}

export function DriverCompliance({ portalColor = '#0f172a' }: { portalColor?: string }) {
  const { profile } = useAuth();
  const subAccount = (profile?.sub_account ?? getSubAccountFilter() ?? 'mcl') as SubAccount;

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<DriverComplianceRecord[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const emptyForm = {
    driver_id: '',
    license_start: '',
    license_expiry: '',
    compliance_start: '',
    compliance_expiry: '',
    atic_insurance_start: '',
    atic_insurance_expiry: '',
  };

  const [form, setForm] = useState(emptyForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [compRes, drvRes] = await Promise.all([
      supabase.from('driver_compliance').select('*, driver:drivers(name, phone)').order('created_at', { ascending: false }),
      supabase.from('drivers').select('id, name, phone').order('name'),
    ]);
    setRecords(compRes.data || []);
    setDrivers(drvRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const activeAlarms = records.filter(r => {
    return [r.license_expiry, r.compliance_expiry, r.atic_insurance_expiry]
      .some(date => {
        const s = getExpiryStatus(date);
        return s === 'expired' || s === 'warning-2w' || s === 'warning-1m';
      });
  });

  const saveRecord = async () => {
    setSaving(true);
    if (editId) {
      await supabase.from('driver_compliance').update(form).eq('id', editId);
    } else {
      await supabase.from('driver_compliance').insert(form);
    }
    setSaving(false);
    setModalOpen(false);
    loadData();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <PageHeader 
          title="Driver Compliance & Licensing" 
          subtitle="Monitor Driver's Licenses, Compliance Documents, and ATIC Insurance Expirations" 
          icon={<UserCheck className="h-6 w-6" />} 
          iconColor={portalColor}
          onAdd={() => { setForm(emptyForm); setEditId(null); setModalOpen(true); }} 
          addLabel="Add Driver Compliance"
        />
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsBulkOpen(true)} 
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
          >
            <Upload className="h-4 w-4 text-slate-500" /> Bulk Import
          </button>
        </div>
      </div>

      {activeAlarms.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <Bell className="h-5 w-5 text-amber-600 mt-0.5 animate-bounce" />
          <div>
            <h4 className="text-sm font-bold text-amber-900">Driver Expiry Notice</h4>
            <p className="text-sm text-amber-700 mt-0.5">
              You have <span className="font-semibold">{activeAlarms.length}</span> driver(s) with documents expiring within 1 month or already expired.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSpinner message="Loading driver compliance records..." />
      ) : records.length === 0 ? (
        <div className="card">
          <EmptyState icon={<UserCheck className="h-8 w-8" />} title="No driver compliance logs found" message="Add compliance schedules manually or use bulk import." />
        </div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Driver Name</th>
                <th>Driver's License</th>
                <th>General Compliance</th>
                <th>ATIC Compliance Insurance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => (
                <tr key={r.id}>
                  <td className="font-semibold text-slate-800">
                    {r.driver?.name || 'Unknown'} <span className="block text-xs font-normal text-slate-500">{r.driver?.phone}</span>
                  </td>
                  <td>
                    <div className="text-xs">Start: {r.license_start || '—'}</div>
                    <StatusBadge date={r.license_expiry} />
                  </td>
                  <td>
                    <div className="text-xs">Start: {r.compliance_start || '—'}</div>
                    <StatusBadge date={r.compliance_expiry} />
                  </td>
                  <td>
                    <div className="text-xs">Start: {r.atic_insurance_start || '—'}</div>
                    <StatusBadge date={r.atic_insurance_expiry} />
                  </td>
                  <td>
                    <button 
                      onClick={() => {
                        const { id, created_at, driver, ...rest } = r as any;
                        setForm(rest);
                        setEditId(id);
                        setModalOpen(true);
                      }} 
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Driver Compliance' : 'Add Driver Compliance'} size="lg">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Select Driver *</label>
            <select className="input" value={form.driver_id} onChange={e => setForm({ ...form, driver_id: e.target.value })}>
              <option value="">Choose driver name</option>
              {drivers.map(d => <option key={d.id} value={d.id}>{d.name} ({d.phone})</option>)}
            </select>
          </div>

          <div className="sm:col-span-2 border-t pt-3 font-semibold text-sm text-slate-700">Driver's License</div>
          <div><label className="label">Start Date</label><input type="date" className="input" value={form.license_start} onChange={e => setForm({ ...form, license_start: e.target.value })} /></div>
          <div><label className="label">Expiry Date</label><input type="date" className="input" value={form.license_expiry} onChange={e => setForm({ ...form, license_expiry: e.target.value })} /></div>

          <div className="sm:col-span-2 border-t pt-3 font-semibold text-sm text-slate-700">General Compliance</div>
          <div><label className="label">Start Date</label><input type="date" className="input" value={form.compliance_start} onChange={e => setForm({ ...form, compliance_start: e.target.value })} /></div>
          <div><label className="label">Expiry Date</label><input type="date" className="input" value={form.compliance_expiry} onChange={e => setForm({ ...form, compliance_expiry: e.target.value })} /></div>

          <div className="sm:col-span-2 border-t pt-3 font-semibold text-sm text-slate-700">ATIC Compliance Insurance</div>
          <div><label className="label">Start Date</label><input type="date" className="input" value={form.atic_insurance_start} onChange={e => setForm({ ...form, atic_insurance_start: e.target.value })} /></div>
          <div><label className="label">Expiry Date</label><input type="date" className="input" value={form.atic_insurance_expiry} onChange={e => setForm({ ...form, atic_insurance_expiry: e.target.value })} /></div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel/Close</button>
          <button onClick={saveRecord} disabled={saving || !form.driver_id} className="btn-primary">{saving ? 'Saving...' : 'Save Driver Compliance'}</button>
        </div>
      </Modal>

      {/* Bulk Import Modal */}
      <BulkImportModal
        open={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        tableName="driver_compliance"
        portalColor={portalColor}
        subAccount={subAccount}
        sampleColumns={[
          'driver_id',
          'license_start',
          'license_expiry',
          'compliance_start',
          'compliance_expiry',
          'atic_insurance_start',
          'atic_insurance_expiry',
        ]}
        onSuccess={loadData}
      />
    </div>
  );
}
