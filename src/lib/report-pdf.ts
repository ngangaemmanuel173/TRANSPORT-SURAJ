import { ReportData } from '@/lib/report-utils';
import { SubAccount, PORTALS } from '@/lib/portals';

let jsPDFLoaded: any = null;

async function loadJsPDF(): Promise<any> {
  if (jsPDFLoaded) return jsPDFLoaded;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    script.onload = () => {
      jsPDFLoaded = (window as any).jspdf.jsPDF;
      resolve(jsPDFLoaded);
    };
    script.onerror = () => reject(new Error('Failed to load PDF library'));
    document.head.appendChild(script);
  });
}

const SUB_ACCOUNT_COLORS: Record<string, [number, number, number]> = {
  mcl: [29, 78, 216],
  tahmal: [21, 128, 61],
  tarmal: [21, 128, 61],
  csl: [194, 65, 12],
  pn_mashru: [124, 58, 237],
  master: [126, 18, 25],
};

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function fmtKES(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-KE', { maximumFractionDigits: 1 });
}

export interface PdfSection {
  title: string;
  build: (doc: any, y: number, color: [number, number, number]) => number;
}

export async function generateReportPDF(
  subAccount: SubAccount,
  periodLabel: string,
  data: ReportData,
  isMaster: boolean = false,
  sections?: PdfSection[],
): Promise<void> {
  const jsPDF = await loadJsPDF();
  const color = SUB_ACCOUNT_COLORS[subAccount] || hexToRgb(PORTALS[subAccount].color);
  const portal = PORTALS[subAccount];
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = 0;

  // --- Cover Page ---
  doc.setFillColor(...color);
  doc.rect(0, 0, pageW, 60, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text(portal.fullName, margin, 30);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('Operations Report', margin, 42);
  doc.setFontSize(11);
  doc.text(`Period: ${periodLabel}`, margin, 52);

  doc.setTextColor(60, 60, 60);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`, margin, 75);
  if (isMaster) {
    doc.text('Master Admin — All Sub-Accounts', margin, 82);
  }

  y = 95;

  const builtSections = sections || buildDefaultSections(data, color, contentW, doc);

  for (const section of builtSections) {
    if (y > pageH - 40) {
      addFooter(doc, pageW, pageH);
      doc.addPage();
      y = margin;
    }
    y = section.build(doc, y, color);
    y += 6;
  }

  addFooter(doc, pageW, pageH);
  const fileName = `${portal.name}_Report_${periodLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  doc.save(fileName);
}

export async function generateCombinedReportPDF(
  subAccounts: SubAccount[],
  periodLabel: string,
  allData: Record<string, ReportData>,
): Promise<void> {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentW = pageW - margin * 2;

  // Cover Page
  doc.setFillColor(126, 18, 25);
  doc.rect(0, 0, pageW, 60, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont('helvetica', 'bold');
  doc.text('Suraj Ashok Limited', margin, 30);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('Combined Operations Report', margin, 42);
  doc.setFontSize(11);
  doc.text(`Period: ${periodLabel}`, margin, 52);

  doc.setTextColor(60, 60, 60);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString('en-GB')}`, margin, 75);
  doc.text('Master Admin — All Sub-Accounts Combined', margin, 82);

  // Table of Contents
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Table of Contents', margin, 100);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  let tocY = 110;
  let pageNum = 2;
  for (const sa of subAccounts) {
    const portal = PORTALS[sa];
    const color = SUB_ACCOUNT_COLORS[sa];
    doc.setTextColor(...color);
    doc.text(`${portal.fullName}  .........  Page ${pageNum}`, margin, tocY);
    tocY += 7;
    pageNum += 1;
  }
  doc.setTextColor(60, 60, 60);

  for (const sa of subAccounts) {
    addFooter(doc, pageW, pageH);
    doc.addPage();
    const data = allData[sa];
    if (!data) continue;
    const color = SUB_ACCOUNT_COLORS[sa];
    const portal = PORTALS[sa];

    // Divider page header
    doc.setFillColor(...color);
    doc.rect(0, 0, pageW, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text(portal.fullName, margin, 25);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(periodLabel, margin, 33);

    doc.setTextColor(60, 60, 60);
    let y = 50;
    const sections = buildDefaultSections(data, color, contentW, doc);
    for (const section of sections) {
      if (y > pageH - 30) {
        addFooter(doc, pageW, pageH);
        doc.addPage();
        y = margin;
      }
      y = section.build(doc, y, color);
      y += 6;
    }
  }

  addFooter(doc, pageW, pageH);
  doc.save(`Combined_Report_${periodLabel.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
}

function addFooter(doc: any, pageW: number, pageH: number) {
  const pageCount = doc.internal.getNumberOfPages();
  const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Generated: ${new Date().toLocaleString('en-GB')}  |  Page ${currentPage} of ${pageCount}`,
    pageW / 2,
    pageH - 8,
    { align: 'center' },
  );
}

function buildDefaultSections(
  data: ReportData,
  color: [number, number, number],
  contentW: number,
  doc: any,
): PdfSection[] {
  const margin = 15;

  function sectionHeader(title: string, y: number): number {
    doc.setFillColor(...color);
    doc.rect(margin, y, contentW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(title, margin + 2, y + 5.5);
    doc.setTextColor(60, 60, 60);
    return y + 12;
  }

  function tableRow(label: string, value: string, y: number, isHeader: boolean = false): number {
    doc.setFontSize(9);
    doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
    doc.text(label, margin + 2, y);
    doc.text(value, margin + contentW - 2, y, { align: 'right' });
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y + 2, margin + contentW, y + 2);
    return y + 6;
  }

  return [
    {
      title: '1. Trips Summary',
      build: (_doc: any, y: number, _c: [number, number, number]) => {
        y = sectionHeader('1. Trips Summary', y);
        const trips = data.trips;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        y = tableRow('Total Trips', String(trips.length), y, true);

        // By truck
        const byTruck: Record<string, { plate: string; count: number }> = {};
        trips.forEach((t: any) => {
          const plate = t.vehicle?.plate_number || 'Unassigned';
          if (!byTruck[plate]) byTruck[plate] = { plate, count: 0 };
          byTruck[plate].count++;
        });
        y = tableRow('— By Truck —', '', y);
        Object.values(byTruck).forEach(v => {
          y = tableRow(`  ${v.plate}`, `${v.count} trips`, y);
        });

        // By driver
        const byDriver: Record<string, { name: string; count: number; mileage: number }> = {};
        trips.forEach((t: any) => {
          const name = t.driver?.name || 'Unassigned';
          if (!byDriver[name]) byDriver[name] = { name, count: 0, mileage: 0 };
          byDriver[name].count++;
          byDriver[name].mileage += Number(t.mileage_payment || 0);
        });
        y = tableRow('— By Driver —', '', y);
        Object.values(byDriver).forEach(v => {
          y = tableRow(`  ${v.name}`, `${v.count} trips | KES ${fmtKES(v.mileage)}`, y);
        });

        // Total distance
        const totalDist = trips.reduce((s: number, t: any) => s + Number(t.distance_km || 0), 0);
        y = tableRow('Total Distance', `${fmtNum(totalDist)} km`, y);
        return y;
      },
    },
    {
      title: '2. Fuel Report',
      build: (_doc: any, y: number, _c: [number, number, number]) => {
        y = sectionHeader('2. Fuel Report', y);
        const fuel = data.fuel;
        const totalExp = fuel.reduce((s: number, f: any) => s + Number(f.expected_litres || 0), 0);
        const totalAct = fuel.reduce((s: number, f: any) => s + Number(f.actual_litres || 0), 0);
        const totalCost = fuel.reduce((s: number, f: any) => s + Number(f.total_cost || 0), 0);
        const variance = totalAct - totalExp;
        y = tableRow('Total Expected (L)', fmtNum(totalExp), y, true);
        y = tableRow('Total Actual (L)', fmtNum(totalAct), y);
        y = tableRow('Variance (L)', fmtNum(variance), y);
        y = tableRow('Total Fuel Cost', `KES ${fmtKES(totalCost)}`, y);
        const avgPerTrip = fuel.length > 0 ? totalCost / fuel.length : 0;
        y = tableRow('Avg Cost per Refuel', `KES ${fmtKES(avgPerTrip)}`, y);

        // By truck
        const byTruck: Record<string, { plate: string; exp: number; act: number }> = {};
        fuel.forEach((f: any) => {
          const plate = f.vehicle?.plate_number || 'Unassigned';
          if (!byTruck[plate]) byTruck[plate] = { plate, exp: 0, act: 0 };
          byTruck[plate].exp += Number(f.expected_litres || 0);
          byTruck[plate].act += Number(f.actual_litres || 0);
        });
        y = tableRow('— By Truck —', '', y);
        Object.values(byTruck).forEach(v => {
          y = tableRow(`  ${v.plate}`, `Exp: ${fmtNum(v.exp)}L | Act: ${fmtNum(v.act)}L`, y);
        });
        return y;
      },
    },
    {
      title: '3. Tallies Report',
      build: (_doc: any, y: number, _c: [number, number, number]) => {
        y = sectionHeader('3. Tallies Report', y);
        const tallies = data.tallies;
        const totalNet = tallies.reduce((s: number, t: any) => s + Number(t.net_tallage || 0), 0);
        y = tableRow('Total Net Tallage', fmtNum(totalNet), y, true);

        // By truck
        const byTruck: Record<string, { plate: string; total: number }> = {};
        tallies.forEach((t: any) => {
          const plate = t.vehicle?.plate_number || 'Unassigned';
          if (!byTruck[plate]) byTruck[plate] = { plate, total: 0 };
          byTruck[plate].total += Number(t.net_tallage || 0);
        });
        y = tableRow('— By Truck —', '', y);
        Object.values(byTruck).forEach(v => {
          y = tableRow(`  ${v.plate}`, fmtNum(v.total), y);
        });

        // Daily totals
        const byDate: Record<string, number> = {};
        tallies.forEach((t: any) => {
          const d = t.tally_date || 'Unknown';
          byDate[d] = (byDate[d] || 0) + Number(t.net_tallage || 0);
        });
        y = tableRow('— Daily Totals —', '', y);
        Object.entries(byDate).forEach(([date, total]) => {
          y = tableRow(`  ${date}`, fmtNum(total), y);
        });
        return y;
      },
    },
    {
      title: '4. Mileage Payments',
      build: (_doc: any, y: number, _c: [number, number, number]) => {
        y = sectionHeader('4. Mileage Payments', y);
        const trips = data.trips;
        const totalMileage = trips.reduce((s: number, t: any) => s + Number(t.mileage_payment || 0), 0);
        y = tableRow('Total Mileage Payments', `KES ${fmtKES(totalMileage)}`, y, true);

        // By driver
        const byDriver: Record<string, number> = {};
        trips.forEach((t: any) => {
          const name = t.driver?.name || 'Unassigned';
          byDriver[name] = (byDriver[name] || 0) + Number(t.mileage_payment || 0);
        });
        y = tableRow('— By Driver —', '', y);
        Object.entries(byDriver).forEach(([name, amt]) => {
          y = tableRow(`  ${name}`, `KES ${fmtKES(amt)}`, y);
        });

        // Route breakdown
        const byRoute: Record<string, number> = {};
        trips.forEach((t: any) => {
          const route = `${t.departure_point || '—'} → ${t.arrival_point || '—'}`;
          byRoute[route] = (byRoute[route] || 0) + Number(t.mileage_payment || 0);
        });
        y = tableRow('— By Route —', '', y);
        Object.entries(byRoute).forEach(([route, amt]) => {
          y = tableRow(`  ${route}`, `KES ${fmtKES(amt)}`, y);
        });
        return y;
      },
    },
    {
      title: '5. Spare Parts',
      build: (_doc: any, y: number, _c: [number, number, number]) => {
        y = sectionHeader('5. Spare Parts', y);
        const parts = data.spareParts;
        const installed = parts.filter((p: any) => p.status === 'in_use');
        const inStore = parts.filter((p: any) => p.status === 'in_store');
        const underRepair = parts.filter((p: any) => p.status === 'under_repair');
        const retired = parts.filter((p: any) => p.status === 'retired');
        y = tableRow('In Use', String(installed.length), y, true);
        y = tableRow('In Store', String(inStore.length), y);
        y = tableRow('Under Repair', String(underRepair.length), y);
        y = tableRow('Retired', String(retired.length), y);
        if (underRepair.length > 0) {
          y = tableRow('— Parts Under Repair —', '', y);
          underRepair.forEach((p: any) => {
            y = tableRow(`  ${p.serial_number} — ${p.part_name}`, p.vehicle?.plate_number || '—', y);
          });
        }
        return y;
      },
    },
    {
      title: '6. Containers',
      build: (_doc: any, y: number, _c: [number, number, number]) => {
        y = sectionHeader('6. Containers', y);
        const containers = data.containers;
        const active = containers.filter((c: any) => c.status === 'active');
        const returned = containers.filter((c: any) => c.status === 'returned');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const overdue = active.filter((c: any) => {
          if (!c.detention_validity) return false;
          return new Date(c.detention_validity) < today;
        });
        const expiring7 = active.filter((c: any) => {
          if (!c.detention_validity) return false;
          const d = new Date(c.detention_validity);
          const diff = (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
          return diff >= 0 && diff <= 7;
        });
        y = tableRow('Active', String(active.length), y, true);
        y = tableRow('Returned', String(returned.length), y);
        y = tableRow('Overdue', String(overdue.length), y);
        y = tableRow('Expiring (7 days)', String(expiring7.length), y);
        if (overdue.length > 0) {
          y = tableRow('— Overdue Containers —', '', y);
          overdue.forEach((c: any) => {
            y = tableRow(`  ${c.container_no}`, c.detention_validity || '—', y);
          });
        }
        return y;
      },
    },
    {
      title: '7. Compliance',
      build: (_doc: any, y: number, _c: [number, number, number]) => {
        y = sectionHeader('7. Compliance', y);
        const now = new Date();

        const expiringItems: string[] = [];
        const expiredItems: string[] = [];
        const in30 = new Date(now.getTime() + 30 * 86400000);

        data.vehicleCompliance.forEach((vc: any) => {
          if (!vc.expiry_date) return;
          const d = new Date(vc.expiry_date);
          const label = `${vc.vehicle?.plate_number || 'Unknown'}: ${(vc.compliance_type || '').replace(/_/g, ' ')}`;
          if (d < now) expiredItems.push(`${label} expired ${vc.expiry_date}`);
          else if (d <= in30) expiringItems.push(`${label} expiring ${vc.expiry_date}`);
        });

        data.driverCompliance.forEach((dc: any) => {
          if (!dc.expiry_date) return;
          const d = new Date(dc.expiry_date);
          const label = `${dc.driver?.name || 'Unknown'}: ${(dc.compliance_type || '').replace(/_/g, ' ')}`;
          if (d < now) expiredItems.push(`${label} expired ${dc.expiry_date}`);
          else if (d <= in30) expiringItems.push(`${label} expiring ${dc.expiry_date}`);
        });

        y = tableRow('Expiring This Month', String(expiringItems.length), y, true);
        y = tableRow('Already Expired', String(expiredItems.length), y);

        if (expiringItems.length > 0) {
          y = tableRow('— Expiring —', '', y);
          expiringItems.forEach(item => {
            y = tableRow(`  ${item}`, '', y);
          });
        }
        if (expiredItems.length > 0) {
          y = tableRow('— Expired —', '', y);
          expiredItems.forEach(item => {
            y = tableRow(`  ${item}`, '', y);
          });
        }
        return y;
      },
    },
  ];
}
