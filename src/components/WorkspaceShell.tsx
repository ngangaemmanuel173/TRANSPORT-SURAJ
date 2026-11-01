import { useState, ReactNode, useEffect } from 'react';
import * as Icons from 'lucide-react';
import {
  Menu, X, LogOut, Truck as TruckIcon, Upload, Download,
  ChevronDown, Building2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { PortalConfig, TabId, SubAccount, PORTALS, MCLArea, getTabsForPortal, pathForSlug } from '@/lib/portals';
import { useToast } from '@/components/Toast';
import { UserRole } from '@/types';
import { downloadExcelTemplate, TEMPLATE_SCHEMAS } from '@/lib/excelTemplates';
import { downloadTemplate, templatesForTab, TEMPLATE_LABELS, TemplateName } from '@/lib/templates';
import { UploadModal } from '@/components/UploadModal';

type IconName = keyof typeof Icons;

const roleLabel = (role: UserRole) => {
  switch (role) {
    case 'corporate_admin': return 'Corporate Admin';
    case 'manager': return 'Manager';
    case 'spares_clerk': return 'Spares';
    case 'reports_clerk': return 'Sales & Reports';
    default: return 'Operations';
  }
};

// Each sub-account keeps its trips in its own table
const TRIPS_TABLE_BY_PORTAL: Record<string, string> = {
  mcl: 'mcl_trips',
  csl: 'csl_trips',
  tarmal: 'tarmal_trips',
  pn_mashru: 'pn_mashru_trips',
};

function getIcon(name: string): Icons.LucideIcon {
  return (Icons[name as IconName] || Icons.Circle) as Icons.LucideIcon;
}

export function WorkspaceShell({
  portal,
  activeTab,
  onTabChange,
  children,
}: {
  portal: PortalConfig;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  children: ReactNode;
  subAccountSwitcher?: boolean;
}) {
  const { profile, signOut } = useAuth();
  const { showToast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  // Bumping this remounts the page so it refetches. (A full page reload would sign the user out.)
  const [refreshKey, setRefreshKey] = useState(0);

  const allTabs = getTabsForPortal(portal.slug, profile?.role);
  const userRole = profile?.role ?? 'employee';
  const isMaster = portal.slug === 'master';
  // The portal switcher is for the Corporate Admin only. The Manager has every sub-account in the sidebar.
  const showPortalSwitcher = isMaster && userRole === 'corporate_admin';

  const navigate = (tab: TabId) => {
    if (tab === activeTab) return;
    onTabChange(tab);
    setSidebarOpen(false);

    const basePath = pathForSlug(portal.slug);
    const newPath = (tab === 'live-monitor' || tab === 'dashboard' || tab === 'overview')
      ? basePath
      : `${basePath}/${tab}`;
    
    if (window.location.pathname !== newPath) {
      window.history.replaceState({ tab }, '', newPath);
    }
  };

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (e.state?.tab) {
        onTabChange(e.state.tab);
        return;
      }
      const segments = window.location.pathname.split('/').filter(Boolean);
      const tabSlug = segments[1] as TabId;
      if (tabSlug) {
        onTabChange(tabSlug);
      } else {
        onTabChange('live-monitor');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [onTabChange]);

  const getTableForActiveTab = (): { tableName: string; templateKey: string } => {
    if (activeTab === 'vehicles') return { tableName: 'vehicles', templateKey: 'vehicles' };
    if (activeTab === 'spare-parts') return { tableName: 'spare_parts_v2', templateKey: 'spare_parts' };
    if (activeTab === 'tyres') return { tableName: 'tyres', templateKey: 'tyres' };
    return { tableName: TRIPS_TABLE_BY_PORTAL[portal.slug] ?? 'sub_account_trips', templateKey: 'trips' };
  };

  const currentMapping = getTableForActiveTab();

  // Template(s) for the page that is open. The importer-compatible Excel schema is used where one exists, otherwise a CSV with headers.
  const templateNames = templatesForTab(activeTab, portal.slug);
  const doDownload = (name: TemplateName) => {
    if (TEMPLATE_SCHEMAS[name]) downloadExcelTemplate(name as any);
    else downloadTemplate(name);
    showToast('Template downloaded successfully', 'success');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 text-slate-100 flex flex-col transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ background: `linear-gradient(180deg, ${portal.colorDark}, ${portal.color})` }}
      >
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-lg">
              <TruckIcon className="h-6 w-6" style={{ color: portal.color }} />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-bold tracking-tight truncate">{portal.fullName}</h1>
              <p className="text-xs text-white/60">Fleet Management</p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {profile && (
          <div className="px-5 py-3 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white">
                {userRole === 'corporate_admin' ? <Icons.Shield className="h-4 w-4" /> : userRole === 'manager' ? <Icons.Briefcase className="h-4 w-4" /> : <Icons.UserCog className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{profile.full_name || profile.email}</p>
                <p className="text-xs text-white/50">{roleLabel(userRole)}</p>
              </div>
            </div>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {allTabs.map(tab => {
            const Icon = getIcon(tab.icon);
            const isActive = activeTab === tab.id;
            const isLiveMonitor = tab.id === 'live-monitor';
            return (
              <button
                key={tab.id}
                onClick={() => navigate(tab.id)}
                className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                  isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate">{tab.label}</span>
                {isLiveMonitor && (
                  <span className="relative ml-auto flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-white/10">
          <button
            onClick={() => signOut()}
            className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium text-white/60 hover:bg-red-500/20 hover:text-red-200 transition-all duration-200"
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </button>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header
          className="sticky top-0 z-20 flex items-center justify-between bg-white border-b border-slate-200 px-4 py-3"
          style={{ borderTop: `3px solid ${portal.color}` }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>

            {/* Sub-Account Switcher dropdown (Visible only for Master admin) */}
            {showPortalSwitcher && (
              <div className="relative">
                <button
                  onClick={() => setShowSwitcher(!showSwitcher)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-800 hover:bg-slate-100 transition-colors shadow-sm"
                >
                  <Building2 className="h-4 w-4 text-red-700" />
                  <span>{portal.fullName}</span>
                  <ChevronDown className="h-4 w-4 text-slate-500" />
                </button>
                {showSwitcher && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowSwitcher(false)} />
                    <div className="absolute left-0 mt-2 w-52 rounded-xl border border-slate-200 bg-white shadow-xl z-20 py-1 animate-fade-in">
                      <button
                        onClick={() => { setShowSwitcher(false); window.location.href = '/admin'; }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 border-b border-slate-100"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-red-700" />
                        Master Fleet Summary
                      </button>
                      {(['mcl', 'tarmal', 'csl', 'pn_mashru'] as SubAccount[]).map(slug => {
                        const p = PORTALS[slug];
                        return (
                          <button
                            key={slug}
                            onClick={() => {
                              setShowSwitcher(false);
                              window.location.href = pathForSlug(slug);
                            }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                            {p.fullName}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => (templateNames.length === 1 ? doDownload(templateNames[0]) : setTplOpen(o => !o))}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{templateNames.length === 1 ? 'Download Template' : 'Download Templates'}</span>
              </button>
              {tplOpen && templateNames.length > 1 && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setTplOpen(false)} />
                  <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {templateNames.map(n => (
                      <button key={n} onClick={() => { doDownload(n); setTplOpen(false); }} className="block w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50">
                        {TEMPLATE_LABELS[n]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {!isMaster && ['trips', 'vehicles', 'spare-parts', 'tyres'].includes(activeTab) && (
              <button
                onClick={() => setIsUploadOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-white rounded-lg px-3 py-2 shadow-sm transition-opacity hover:opacity-90"
                style={{ background: portal.color }}
              >
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Upload</span>
              </button>
            )}
          </div>
        </header>

        <main key={refreshKey} className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </main>
      </div>

      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        tableName={currentMapping.tableName}
        subAccount={portal.slug}
        onSuccess={() => {
          showToast('Data imported successfully!', 'success');
          setRefreshKey(k => k + 1);
        }}
      />
    </div>
  );
}
