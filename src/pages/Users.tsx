import { useEffect, useState, useCallback } from 'react';
import { Users as UsersIcon, Search, Shield, Briefcase, UserCog } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Profile, UserRole } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner, EmptyState } from '@/components/Shared';
import { portalLabel } from '@/lib/portals';
import { useToast } from '@/components/Toast';

const roleBadge = (role: UserRole) => {
  switch (role) {
    case 'corporate_admin': return <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"><Shield className="h-3 w-3" /> Corporate Admin</span>;
    case 'manager': return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"><Briefcase className="h-3 w-3" /> Manager</span>;
    case 'spares_clerk': return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700"><UserCog className="h-3 w-3" /> Spares</span>;
    case 'reports_clerk': return <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700"><UserCog className="h-3 w-3" /> Sales &amp; Reports</span>;
    default: return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"><UserCog className="h-3 w-3" /> Operations</span>;
  }
};

const roleIcon = (role: UserRole) => {
  switch (role) {
    case 'corporate_admin': return <Shield className="h-5 w-5 text-blue-500" />;
    case 'manager': return <Briefcase className="h-5 w-5 text-emerald-500" />;
    default: return <UserCog className="h-5 w-5 text-slate-400" />;
  }
};

export function Users() {
  const { profile: currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const { showToast } = useToast();
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null);
  const [togglingSignup, setTogglingSignup] = useState(false);

  const loadSignup = useCallback(async () => {
    const { data } = await supabase.rpc('signup_status');
    if (data) setSignupOpen(data.open !== false);
  }, []);
  useEffect(() => { loadSignup(); }, [loadSignup]);

  const toggleSignup = async () => {
    if (signupOpen === null) return;
    setTogglingSignup(true);
    const { error } = await supabase.rpc('set_signup_open', { is_open: !signupOpen });
    setTogglingSignup(false);
    if (error) { (showToast as any)(error.message, 'error'); return; }
    (showToast as any)(!signupOpen ? 'Sign-up is now open' : 'Sign-up is now closed', 'success');
    loadSignup();
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[Users] Failed to load profiles:', error);
    }
    setProfiles(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateRole = async (id: string, newRole: UserRole) => {
    setUpdatingId(id);
    // Clerks are universal (master account); everyone else must belong to one sub-account.
    const current = profiles.find(p => p.id === id);
    const patch: any = { role: newRole };
    // Manager, Spares and Sales & Reports are universal (master); only Operations has one sub-account.
    if (newRole === 'spares_clerk' || newRole === 'reports_clerk' || newRole === 'manager') patch.sub_account = 'master';
    else if (newRole !== 'corporate_admin' && current?.sub_account === 'master') patch.sub_account = 'mcl';
    const { error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', id);
    if (error) {
      console.error('[Users] Failed to update role:', error);
      (showToast as any)(error.message.includes('one_corporate_admin') ? 'There can only be one Corporate Admin.' : error.message, 'error');
    }
    setUpdatingId(null);
    load();
  };

  const filtered = profiles.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q) || p.role.toLowerCase().includes(q);
  });

  const counts = {
    corporate_admin: profiles.filter(p => p.role === 'corporate_admin').length,
    manager: profiles.filter(p => p.role === 'manager').length,
    employee: profiles.filter(p => p.role === 'employee').length,
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <PageHeader title="Users" subtitle="Manage user accounts and roles" icon={<UsersIcon className="h-6 w-6" />} />

      <div className="card p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">Sign-up is {signupOpen === null ? '…' : signupOpen ? 'OPEN' : 'CLOSED'}</p>
          <p className="text-xs text-slate-500">When everyone has registered, close sign-up so no one else can create an account. You can reopen it any time.</p>
        </div>
        <button
          onClick={toggleSignup}
          disabled={signupOpen === null || togglingSignup}
          className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${signupOpen ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
        >
          {togglingSignup ? 'Saving...' : signupOpen ? 'Close sign-up' : 'Open sign-up'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-500" />
            <p className="text-xs text-slate-400">Corporate Admins</p>
          </div>
          <p className="text-lg font-bold text-slate-700 mt-1">{counts.corporate_admin}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-emerald-500" />
            <p className="text-xs text-slate-400">Managers</p>
          </div>
          <p className="text-lg font-bold text-slate-700 mt-1">{counts.manager}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-slate-400" />
            <p className="text-xs text-slate-400">Employees</p>
          </div>
          <p className="text-lg font-bold text-slate-700 mt-1">{counts.employee}</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input className="input pl-9" placeholder="Search by name, email, or role..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <LoadingSpinner message="Loading users..." />
      ) : filtered.length === 0 ? (
        <div className="card"><EmptyState icon={<UsersIcon className="h-8 w-8" />} title="No users found" message="No user profiles match your search." /></div>
      ) : (
        <div className="card table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Sub-Account</th>
                <th>Current Role</th>
                <th>Change Role</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
                        {roleIcon(p.role)}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{p.full_name || 'Unnamed'}</p>
                        {currentUser?.id === p.id && <span className="text-xs text-blue-500">You</span>}
                      </div>
                    </div>
                  </td>
                  <td className="text-slate-600 text-sm">{p.email}</td>
                  <td className="text-slate-600 text-sm capitalize">{portalLabel(p.sub_account)}</td>
                  <td>{roleBadge(p.role)}</td>
                  <td>
                    <select
                      className="input text-sm py-1.5 px-3 w-auto"
                      value={p.role}
                      disabled={updatingId === p.id || currentUser?.id === p.id}
                      onChange={e => updateRole(p.id, e.target.value as UserRole)}
                    >
                      <option value="employee">Operations (per sub-account)</option>
                      <option value="spares_clerk">Spares (all sub-accounts)</option>
                      <option value="reports_clerk">Sales &amp; Reports (all sub-accounts)</option>
                      <option value="manager">Manager (all sub-accounts)</option>
                      <option value="corporate_admin" disabled={p.role !== 'corporate_admin' && counts.corporate_admin >= 1}>Corporate Admin (one person only)</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
