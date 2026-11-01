import { useState, CSSProperties } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/Toast';
import { PortalConfig, PORTALS } from '@/lib/portals';
import { Truck, Lock, Mail, User, Building, Eye, EyeOff } from 'lucide-react';

export function AuthPage({ portal }: { portal?: PortalConfig }) {
  const p = portal ?? PORTALS.master;
  const { showToast } = useToast();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [subAccount, setSubAccount] = useState('mcl');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isMasterPortal = p.slug === 'master';
  const accentVars = { '--accent': p.color } as CSSProperties;
  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 outline-none focus:border-[color:var(--accent)]';

  const switchMode = (signUp: boolean) => {
    setIsSignUp(signUp);
    setErrorMsg('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              sub_account: isMasterPortal ? subAccount : p.slug,
              role: 'employee',
            },
          },
        });
        if (error) throw error;
        showToast('Account created successfully! You can now sign in.', 'success');
        setIsSignUp(false);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showToast('Signed in successfully!', 'success');
      }
    } catch (err: any) {
      const msg = err?.message || 'Authentication failed';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 animate-fade-in"
      style={{ background: p.colorDark, ...accentVars }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="px-8 py-9 text-center text-white" style={{ background: p.color }}>
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg">
            <Truck className="h-8 w-8" style={{ color: p.color }} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">{p.fullName}</h1>
          <p className="mt-1 text-sm text-white/70">Fleet Management System</p>
        </div>

        <div className="space-y-5 p-8">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => switchMode(false)}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                !isSignUp ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => switchMode(true)}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                isSignUp ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            {isSignUp && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    autoComplete="off"
                    className={inputClass}
                    placeholder="John Doe"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                  />
                </div>
              </div>
            )}

            {isSignUp && isMasterPortal && (
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Sub-Account / Portal</label>
                <div className="relative">
                  <Building className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <select
                    className={inputClass}
                    value={subAccount}
                    onChange={e => setSubAccount(e.target.value)}
                  >
                    <option value="mcl">MCL</option>
                    <option value="tarmal">TARMAL</option>
                    <option value="csl">CSL</option>
                    <option value="pn_mashru">PN_MASHRU</option>
                  </select>
                </div>
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  autoComplete="off"
                  className={inputClass}
                  placeholder="name@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  className={`${inputClass} pr-10`}
                  placeholder="Your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg py-3 text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: p.color }}
            >
              {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
