import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { useAuth, AuthProvider } from '@/lib/auth';
import { AuthPage } from '@/pages/AuthPage';
import { ToastProvider } from '@/components/Toast';
import { WorkspaceShell } from '@/components/WorkspaceShell';
import { LoadingSpinner } from '@/components/Shared';
import { setSubAccountFilter, supabaseConfigured } from '@/lib/supabase';

// Existing pages
import { Dashboard } from '@/pages/Dashboard';
import { Users } from '@/pages/Users';
import { DriversPage } from '@/pages/DriversPage';
import { VehiclesPage } from '@/pages/VehiclesPage';

// Sub-account pages
import { SubAccountTrips } from '@/pages/SubAccountTrips';
import { SubAccountTallies } from '@/pages/SubAccountTallies';
import { SubAccountFuel } from '@/pages/SubAccountFuel';
import { SparePartsV2 } from '@/pages/SparePartsV2';
import { TyresPage } from '@/pages/TyresPage';
import { CompliancePageFull } from '@/pages/CompliancePageFull';
import { ContainersPage } from '@/pages/ContainersPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { MasterReportsPage } from '@/pages/MasterReportsPage';

// Placeholder and Monitor pages
import { OverviewPage } from '@/pages/PlaceholderPages';
import { LiveMonitor } from '@/pages/LiveMonitor';

import { portalFromPath, slugFromPath, PORTALS, TabId, SubAccount, getTabsForPortal } from '@/lib/portals';
import { isClerk } from '@/types';
import { DriverAllowancesPage } from '@/pages/DriverAllowancesPage';
import { CostReportsPage } from '@/pages/CostReportsPage';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class PageErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🚨 [Page Crash Caught]:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 rounded-2xl bg-red-50 border border-red-200 text-center max-w-lg mx-auto my-12 shadow-sm">
          <h3 className="text-base font-bold text-red-800 mb-2">Unable to load this section</h3>
          <p className="text-xs text-red-600 mb-4 font-mono bg-red-100/50 p-3 rounded-lg overflow-x-auto text-left">
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 transition-colors shadow-sm"
          >
            Reload Workspace
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function SubAccountDashboardWrapper({ subAccount, onViewAllContainers, onViewCompliance }: { subAccount: SubAccount; onViewAllContainers: () => void; onViewCompliance: () => void }) {
  useEffect(() => {
    setSubAccountFilter(subAccount);
    return () => {
      setSubAccountFilter('master');
    };
  }, [subAccount]);

  return (
    <Dashboard 
      key={subAccount} 
      onViewAllContainers={onViewAllContainers} 
      onViewCompliance={onViewCompliance} 
    />
  );
}

// Pins the sub-account proxy to one sub-account while a universal clerk page is open.
function SubAccountScope({ sub, children }: { sub: SubAccount; children: ReactNode }) {
  useEffect(() => {
    setSubAccountFilter(sub);
    return () => { setSubAccountFilter('master'); };
  }, [sub]);
  return <React.Fragment key={sub}>{children}</React.Fragment>;
}

function AppContent() {
  const { user, profile, loading, authError, retry } = useAuth();
  
  const getInitialTab = (): TabId => {
    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments[0] === 'admin') {
      return (segments[1] as TabId) || 'overview';
    }
    return (segments[1] as TabId) || 'dashboard';
  };

  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab);

  const pathSlug = slugFromPath(window.location.pathname);
  const portal = pathSlug ? (portalFromPath(window.location.pathname) ?? PORTALS.master) : PORTALS.master;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <LoadingSpinner message="Loading..." />
        {authError && (
          <div className="max-w-sm rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-center">
            <p className="text-sm text-red-600 mb-2">{authError}</p>
            <button onClick={() => retry()} className="text-sm font-medium text-red-700 hover:text-red-800">Retry</button>
          </div>
        )}
      </div>
    );
  }

  // One login page for every account type (no per-sub-account login pages)
  if (!user || !profile) {
    return <AuthPage />;
  }

  // SECURITY / ROUTING CHECK: a non-master user may only ever be in their own portal.
  // Anything else ("/", "/admin", unknown paths, another sub-account) is sent to their portal.
  const userSubAccount = profile?.sub_account;
  const firstSegment = window.location.pathname.split('/').filter(Boolean)[0];
  if (userSubAccount && userSubAccount !== 'master' && userSubAccount !== 'admin' && firstSegment !== userSubAccount) {
    window.location.replace(`/${userSubAccount}`);
    return <LoadingSpinner message="Redirecting to your authorized portal..." />;
  }

  // A master user browsing a sub-account portal (/mcl, /csl, ...) should see only that
  // sub-account's data. Set synchronously so child pages fetch with the right filter.
  if (portal.slug !== 'master' && (userSubAccount === 'master' || userSubAccount === 'admin')) {
    setSubAccountFilter(portal.slug);
  }

  const isMaster = portal.slug === 'master' || window.location.pathname.startsWith('/admin');
  const role = profile.role;
  const clerk = isClerk(role);

  // Clerks and the universal Manager live on the master account only (no per-sub-account logins)
  if ((clerk || role === 'manager') && portal.slug !== 'master') {
    window.location.replace('/admin');
    return <LoadingSpinner message="Redirecting..." />;
  }

  // One role per login: only render tabs this role is allowed to see
  const allowedTabs = getTabsForPortal(portal.slug, role);
  const currentTab: TabId = allowedTabs.some(t => t.id === activeTab) ? activeTab : allowedTabs[0].id;

  const renderTabContent = () => {
    if (role === 'spares_clerk' && currentTab.startsWith('spares-')) {
      const sub = currentTab.replace('spares-', '') as SubAccount;
      return (
        <SubAccountScope sub={sub}>
          <SparePartsV2 mclArea={null} portalColor={portal.color} forceSubAccount={sub} />
        </SubAccountScope>
      );
    }
    if (clerk) {
      switch (currentTab) {
        case 'cost-reports': return <CostReportsPage portalColor={portal.color} />;
        case 'spare-parts': return <SparePartsV2 mclArea={null} portalColor={portal.color} />;
        case 'tyres': return <TyresPage mclArea={null} portalColor={portal.color} />;
        default: return null;
      }
    }
    if (isMaster) {
      switch (currentTab) {
        case 'live-monitor': return <LiveMonitor color={portal.color} subAccountFilter="all" />;
        case 'overview': return role === 'corporate_admin' ? <OverviewPage color={portal.color} /> : null;
        case 'dashboard': return <OverviewPage color={portal.color} />;
        
        case 'mcl': 
          return <SubAccountDashboardWrapper key="mcl" subAccount="mcl" onViewAllContainers={() => setActiveTab('containers')} onViewCompliance={() => setActiveTab('compliance')} />;
        case 'tarmal': 
          return <SubAccountDashboardWrapper key="tarmal" subAccount="tarmal" onViewAllContainers={() => setActiveTab('containers')} onViewCompliance={() => setActiveTab('compliance')} />;
        case 'csl': 
          return <SubAccountDashboardWrapper key="csl" subAccount="csl" onViewAllContainers={() => setActiveTab('containers')} onViewCompliance={() => setActiveTab('compliance')} />;
        case 'pn_mashru': 
          return <SubAccountDashboardWrapper key="pn_mashru" subAccount="pn_mashru" onViewAllContainers={() => setActiveTab('containers')} onViewCompliance={() => setActiveTab('compliance')} />;
        
        case 'users': return role === 'corporate_admin' ? <Users /> : null;
        case 'drivers': return <DriversPage portalColor={portal.color} isMaster />;
        case 'vehicles': return <VehiclesPage portalColor={portal.color} isMaster />;
        case 'spare-parts': return <SparePartsV2 mclArea={null} portalColor={portal.color} isMaster />;
        case 'tyres': return <TyresPage mclArea={null} portalColor={portal.color} isMaster />;
        case 'containers': return <ContainersPage mclArea={null} portalColor={portal.color} isMaster />;
        case 'compliance': return <CompliancePageFull mclArea={null} portalColor={portal.color} isMaster />;
        case 'reports': return <MasterReportsPage portalColor={portal.color} />;
        case 'cost-reports': return <CostReportsPage portalColor={portal.color} />;
        default: return <OverviewPage color={portal.color} />;
      }
    }

    switch (currentTab) {
      case 'live-monitor': return <LiveMonitor color={portal.color} subAccountFilter={portal.slug} />;
      case 'dashboard': return <Dashboard onViewAllContainers={() => setActiveTab('containers')} onViewCompliance={() => setActiveTab('compliance')} />;
      case 'trips': return <SubAccountTrips mclArea={null} portalColor={portal.color} />;
      case 'fuel': return <SubAccountFuel mclArea={null} portalColor={portal.color} />;
      case 'allowances': return <DriverAllowancesPage portalColor={portal.color} subAccount={portal.slug} />;
      case 'cost-reports': return <CostReportsPage portalColor={portal.color} lockedSubAccount={portal.slug} />;
      case 'tallies': return <SubAccountTallies mclArea={null} portalColor={portal.color} />;
      case 'drivers': return <DriversPage portalColor={portal.color} />;
      case 'vehicles': return <VehiclesPage portalColor={portal.color} />;
      case 'spare-parts': return <SparePartsV2 mclArea={null} portalColor={portal.color} />;
      case 'tyres': return <TyresPage mclArea={null} portalColor={portal.color} />;
      case 'containers': return <ContainersPage mclArea={null} portalColor={portal.color} />;
      // Operations fills in the truck and driver compliance of their own sub-account
      case 'compliance': return <CompliancePageFull mclArea={null} portalColor={portal.color} subAccount={portal.slug} />;
      case 'reports': return <ReportsPage mclArea={null} portalColor={portal.color} />;
      default: return <Dashboard onViewAllContainers={() => setActiveTab('containers')} onViewCompliance={() => setActiveTab('compliance')} />;
    }
  };

  return (
    <WorkspaceShell
      portal={portal}
      activeTab={currentTab}
      onTabChange={setActiveTab}
      subAccountSwitcher={isMaster && !clerk}
    >
      <PageErrorBoundary>
        {renderTabContent()}
      </PageErrorBoundary>
    </WorkspaceShell>
  );
}

function MissingConfig() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <h1 className="text-base font-bold text-red-800 mb-2">App is not configured</h1>
        <p className="text-sm text-red-700">
          <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are missing.
          Add them in your hosting environment settings and redeploy.
        </p>
      </div>
    </div>
  );
}

function App() {
  if (!supabaseConfigured) return <MissingConfig />;
  return (
    <ToastProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
