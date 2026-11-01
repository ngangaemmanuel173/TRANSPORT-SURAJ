export type SubAccount = 'master' | 'mcl' | 'tarmal' | 'csl' | 'pn_mashru';

export type TabId =
  | 'live-monitor'
  | 'overview'
  | 'dashboard'
  | 'vehicles'
  | 'trips'
  | 'fuel'
  | 'tallies'
  | 'drivers'
  | 'spare-parts'
  | 'tyres'
  | 'allowances'
  | 'cost-reports'
  | 'spares-mcl'
  | 'spares-csl'
  | 'spares-pn_mashru'
  | 'spares-tarmal'
  | 'containers'
  | 'compliance'
  | 'reports'
  | 'users'
  | 'mcl'
  | 'tarmal'
  | 'csl'
  | 'pn_mashru';

export type MCLArea = 'karuri' | 'kiambu' | 'ruiru' | 'thika';

export interface PortalConfig {
  slug: SubAccount;
  name: string;
  fullName: string;
  color: string;
  colorDark: string;
}

export const PORTALS: Record<SubAccount, PortalConfig> = {
  master: {
    slug: 'master',
    name: 'Suraj Ashok Limited',
    fullName: 'Suraj Ashok Limited — Master',
    color: '#8b0000',
    colorDark: '#5c0000',
  },
  mcl: {
    slug: 'mcl',
    name: 'MCL',
    fullName: 'MCL Freight',
    color: '#1e3a8a',
    colorDark: '#172554',
  },
  tarmal: {
    slug: 'tarmal',
    name: 'Tarmal',
    fullName: 'Tarmal Freight',
    color: '#047857',
    colorDark: '#064e3b',
  },
  csl: {
    slug: 'csl',
    name: 'CSL',
    fullName: 'CSL Freight',
    color: '#b45309',
    colorDark: '#78350f',
  },
  pn_mashru: {
    slug: 'pn_mashru',
    name: 'PN Mashru',
    fullName: 'P.N. Mashru Transporters',
    color: '#4338ca',
    colorDark: '#312e81',
  },
};

export interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

export function portalLabel(slug: SubAccount): string {
  return PORTALS[slug]?.fullName ?? slug.toUpperCase();
}

export function getTabsForPortal(slug: SubAccount, role?: string | null): TabConfig[] {
  // Universal clerk logins (one role per login)
  if (role === 'spares_clerk') {
    return [
      { id: 'spares-mcl', label: 'MCL Spares', icon: 'Wrench' },
      { id: 'spares-csl', label: 'CSL Spares', icon: 'Wrench' },
      { id: 'spares-pn_mashru', label: 'PN Mashru Spares', icon: 'Wrench' },
      { id: 'spares-tarmal', label: 'Tarmal Spares', icon: 'Wrench' },
      { id: 'tyres', label: 'Tyres', icon: 'Disc' },
    ];
  }
  if (role === 'reports_clerk') {
    return [
      { id: 'cost-reports', label: 'Reports & Costs', icon: 'FileText' },
      { id: 'spare-parts', label: 'Spares (edit)', icon: 'Wrench' },
      { id: 'tyres', label: 'Tyres (edit)', icon: 'Disc' },
    ];
  }
  // Manager: universal. Sees and edits all four sub-accounts from one login.
  // Not included: the master Overview and the Users page (Corporate Admin only).
  if (role === 'manager') {
    return [
      { id: 'live-monitor', label: 'Live Monitor', icon: 'Activity' },
      { id: 'mcl', label: 'MCL', icon: 'Building2' },
      { id: 'tarmal', label: 'Tarmal', icon: 'Building2' },
      { id: 'csl', label: 'CSL', icon: 'Building2' },
      { id: 'pn_mashru', label: 'PN Mashru', icon: 'Building2' },
      { id: 'drivers', label: 'Drivers', icon: 'Users' },
      { id: 'vehicles', label: 'Trucks / Vehicles', icon: 'Truck' },
      { id: 'spare-parts', label: 'Spare Parts', icon: 'Wrench' },
      { id: 'tyres', label: 'Tyres', icon: 'Disc' },
      { id: 'containers', label: 'Containers', icon: 'Package' },
      { id: 'compliance', label: 'Compliance', icon: 'ShieldCheck' },
      { id: 'reports', label: 'Reports', icon: 'FileText' },
      { id: 'cost-reports', label: 'Reports & Costs', icon: 'FileText' },
    ];
  }
  // Operations login: trips, fuel, driver allowances, compliance and the remaining pages, no spares / reports
  if (slug !== 'master' && role === 'employee') {
    return [
      { id: 'live-monitor', label: 'Live Monitor', icon: 'Activity' },
      { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
      { id: 'trips', label: 'Trips', icon: 'Route' },
      { id: 'fuel', label: 'Fuel', icon: 'Fuel' },
      { id: 'allowances', label: 'Driver Allowances', icon: 'Wallet' },
      { id: 'tallies', label: 'Tallies', icon: 'Calculator' },
      { id: 'drivers', label: 'Drivers', icon: 'Users' },
      { id: 'vehicles', label: 'Trucks / Vehicles', icon: 'Truck' },
      { id: 'containers', label: 'Containers', icon: 'Package' },
      { id: 'compliance', label: 'Compliance', icon: 'ShieldCheck' },
    ];
  }
  if (slug === 'master') {
    return [
      { id: 'live-monitor', label: 'Live Monitor', icon: 'Activity' },
      { id: 'overview', label: 'Overview', icon: 'LayoutDashboard' },
      { id: 'mcl', label: 'MCL', icon: 'Building2' },
      { id: 'tarmal', label: 'Tarmal', icon: 'Building2' },
      { id: 'csl', label: 'CSL', icon: 'Building2' },
      { id: 'pn_mashru', label: 'PN Mashru', icon: 'Building2' },
      { id: 'drivers', label: 'Drivers', icon: 'Users' },
      { id: 'vehicles', label: 'Trucks / Vehicles', icon: 'Truck' },
      { id: 'users', label: 'Users', icon: 'UserCog' },
      { id: 'spare-parts', label: 'Spare Parts', icon: 'Wrench' },
      { id: 'tyres', label: 'Tyres', icon: 'Disc' },
      { id: 'containers', label: 'Containers', icon: 'Package' },
      { id: 'compliance', label: 'Compliance', icon: 'ShieldCheck' },
      { id: 'reports', label: 'Reports', icon: 'FileText' },
      { id: 'cost-reports', label: 'Cost Reports', icon: 'FileText' },
    ];
  }

  return [
    { id: 'live-monitor', label: 'Live Monitor', icon: 'Activity' },
    { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
    { id: 'trips', label: 'Trips', icon: 'Route' },
    { id: 'fuel', label: 'Fuel', icon: 'Fuel' },
    { id: 'allowances', label: 'Driver Allowances', icon: 'Wallet' },
    { id: 'tallies', label: 'Tallies', icon: 'Calculator' },
    { id: 'drivers', label: 'Drivers', icon: 'Users' },
    { id: 'vehicles', label: 'Trucks / Vehicles', icon: 'Truck' },
    { id: 'spare-parts', label: 'Spare Parts', icon: 'Wrench' },
    { id: 'tyres', label: 'Tyres', icon: 'Disc' },
    { id: 'containers', label: 'Containers', icon: 'Package' },
    { id: 'compliance', label: 'Compliance', icon: 'ShieldCheck' },
    { id: 'reports', label: 'Reports', icon: 'FileText' },
    { id: 'cost-reports', label: 'Cost Reports', icon: 'FileText' },
  ];
}

export function portalFromPath(pathname: string): PortalConfig | undefined {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (!segment) return PORTALS.master;
  return Object.values(PORTALS).find(p => p.slug === segment);
}

export function slugFromPath(pathname: string): SubAccount | undefined {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (!segment) return 'master';
  if (PORTALS[segment as SubAccount]) return segment as SubAccount;
  return undefined;
}

export function pathForSlug(slug: SubAccount): string {
  if (slug === 'master') return '/admin';
  return `/${slug}`;
}
