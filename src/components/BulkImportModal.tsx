import { useState, useRef } from 'react';
import { X, Download, Upload, FileText, CheckCircle2, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/Toast';
import { SubAccount } from '@/lib/portals';
import type { ImportPlan, PlanResult, MergeResult } from '@/lib/mergeImport';

interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
  tableName: string;
  portalColor: string;
  subAccount: SubAccount;
  sampleColumns: string[];
  /** Optional example row for the template (same order as sampleColumns) */
  sampleRow?: string[];
  /** Optional per-row clean-up before insert. Return null to skip the row. */
  transformRecord?: (record: Record<string, any>) => Record<string, any> | null;
  /** Optional custom insert (e.g. Tyres: skips serials that already exist and writes history). Replaces the plain insert. */
  insertRecord?: (record: Record<string, any>) => Promise<{ ok: boolean; skipped?: boolean; error?: string }>;
  /** Optional "preview first" import: decides per row what would happen (nothing is saved). Needs applyPlan. */
  planRecord?: (record: Record<string, any>, earlier: ImportPlan[]) => Promise<PlanResult>;
  /** Carries out one plan once the person confirms the preview. */
  applyPlan?: (plan: ImportPlan) => Promise<MergeResult>;
  /** Short text that names a row in the preview (for example truck, date and delivery number). */
  labelRecord?: (record: Record<string, any>) => string;
  onSuccess: () => void;
}

// Excel saves dates as dd/mm/yyyy, but the database reads that as mm/dd/yyyy and swaps day and month
// (02/11/2026 becomes 11 February). Convert day-first dates to yyyy-mm-dd before saving.
function normalizeDateValue(header: string, value: string): string {
  const h = header.trim().toLowerCase();
  if (!h.includes('date') && h !== 'eta') return value;
  const m = value.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (!m) return value;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Splits one CSV/TSV line, keeping delimiters that sit inside "quotes" (e.g. a note like "Fitted on KDX 937L, diff"). */
function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function BulkImportModal({
  open,
  onClose,
  tableName,
  portalColor,
  subAccount,
  sampleColumns,
  sampleRow,
  transformRecord,
  insertRecord,
  planRecord,
  applyPlan,
  labelRecord,
  onSuccess,
}: BulkImportModalProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState('');
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');
  const [plans, setPlans] = useState<ImportPlan[] | null>(null);
  const [planErrors, setPlanErrors] = useState<string[]>([]);
  const [planErrorCount, setPlanErrorCount] = useState(0);

  if (!open) return null;

  // 1. Download CSV Template
  const downloadTemplate = () => {
    const headerRow = sampleColumns.join(',');
    const sampleRowCsv = (sampleRow ?? sampleColumns.map(() => 'sample_value')).join(',');
    const csvContent = `data:text/csv;charset=utf-8,${headerRow}\n${sampleRowCsv}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${tableName}_template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Template downloaded successfully', 'success');
  };

  // 2. Handle File Selection from Computer
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setPlans(null);
    const reader = new FileReader();
    reader.onload = event => {
      const text = event.target?.result as string;
      if (text) {
        setRawText(text);
      }
    };
    reader.readAsText(file);
  };

  // Columns that must stay as text (dates, ids, labels), even if the name contains "trip" or "fuel"
  const TEXT_COLUMNS = new Set([
    'trip_date', 'trip_ref', 'fuel_date', 'sub_account', 'mcl_area_id', 'departure_point',
    'arrival_point', 'destination', 'destination_city', 'trailer_number', 'status', 'notes',
    'vehicle_id', 'driver_id', 'current_truck', 'serial_number', 'part_name', 'part_type', 'category', 'supplier',
  ]);
  // Numeric columns where an empty cell should stay empty (NULL) instead of becoming 0
  const NULLABLE_NUMERIC = new Set(['unit_cost']);

  // Helper to check if a column is typically numeric
  const isNumericHeader = (header: string): boolean => {
    const h = header.trim().toLowerCase();
    if (TEXT_COLUMNS.has(h) || h.includes('date')) return false;
    return (
      h.includes('ton') ||
      h.includes('trip') ||
      h.includes('fuel') ||
      h.includes('bal') ||
      h.includes('litr') ||
      h.includes('cost') ||
      h.includes('rate') ||
      h.includes('qty') ||
      h.includes('quantity') ||
      h.includes('amount') ||
      h.includes('usage') ||
      h.includes('loss') ||
      h.includes('gain') ||
      h.includes('empty') ||
      h.startsWith('__empty')
    );
  };

  type Item = { row: number; record: Record<string, any> };

  // Reads the text into records ready to save. Rows that cannot be used are listed in `errors`.
  const buildRecords = (): { items: Item[]; errors: { message?: string }[] } | null => {
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      showToast('CSV file is empty or missing data rows', 'error');
      return null;
    }

    // Support comma or tab separation
    const delimiter = lines[0].includes('\t') ? '\t' : ',';
    const headers = splitCsvLine(lines[0], delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
    const items: Item[] = [];
    const errors: { message?: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = splitCsvLine(lines[i], delimiter).map(v => v.trim());
      // The per-sub-account trips tables (mcl_trips, csl_trips, ...) keep the data apart by being separate
      // tables and have no sub_account column, so it must not be sent for them.
      const OWN_TRIPS = ['mcl_trips', 'csl_trips', 'tarmal_trips', 'pn_mashru_trips', 'mushroom_trips'];
      const record: Record<string, any> = OWN_TRIPS.includes(tableName) ? {} : { sub_account: subAccount };
      const baseKeys = Object.keys(record).length;

      headers.forEach((header, index) => {
        if (!header) return;
        const rawVal = values[index];

        if (isNumericHeader(header)) {
          // Convert numbers safely, default to 0 for invalid/empty entries or letter artifacts
          if (rawVal === undefined || rawVal === '' || isNaN(Number(rawVal))) {
            record[header] = NULLABLE_NUMERIC.has(header.trim().toLowerCase()) ? null : 0;
          } else {
            record[header] = Number(rawVal);
          }
        } else {
          // Handle text or category codes
          if (rawVal !== undefined && rawVal !== '') {
            record[header] = normalizeDateValue(header, rawVal);
          } else {
            record[header] = null;
          }
        }
      });

      // Skip row if no actual values were assigned beyond sub_account
      if (Object.keys(record).length <= baseKeys) continue;

      let finalRecord: Record<string, any> | null = record;
      try {
        finalRecord = transformRecord ? transformRecord(record) : record;
      } catch (err: any) {
        // transformRecord can throw an Error that says what is wrong with the row
        errors.push({ message: `Row ${i + 1}: ${err?.message || 'invalid row'}` });
        continue;
      }
      if (!finalRecord) { errors.push({}); continue; }
      items.push({ row: i + 1, record: finalRecord });
    }
    return { items, errors };
  };

  const report = (c: { success: number; updated: number; skipped: number; error: number; kept: number; firstError: string }) => {
    const skippedText = c.skipped > 0 ? `, ${c.skipped} skipped (already exist, nothing new to add)` : '';
    const updatedText = c.updated > 0 ? `, ${c.updated} existing record(s) completed with the missing details` : '';
    const keptText = c.kept > 0 ? ` (${c.kept} value(s) in the file differed from what is saved; the saved values were kept)` : '';
    if (c.success > 0 || c.updated > 0) {
      showToast(`Successfully imported ${c.success} new record(s)${updatedText}${skippedText}${keptText}${c.error > 0 ? `, ${c.error} failed${c.firstError ? ` (${c.firstError})` : ''}` : ''}`, 'success');
      onSuccess();
      onClose();
    } else if (c.skipped > 0 && c.error === 0) {
      showToast(`Nothing new to import: all ${c.skipped} record(s) already exist.`, 'success');
      onSuccess();
      onClose();
    } else {
      showToast(c.firstError ? `Import failed. ${c.firstError}` : 'Import failed. Check your file formatting and columns.', 'error');
    }
  };

  // 3a. Direct import: parse and save row by row
  const handleImport = async () => {
    if (!rawText.trim()) {
      showToast('Please upload a CSV file or paste data', 'error');
      return;
    }

    setImporting(true);
    try {
      const built = buildRecords();
      if (!built) return;
      let success = 0, skipped = 0;
      let error = built.errors.length;
      let firstError = built.errors.find(e => e.message)?.message ?? '';

      for (const { row, record } of built.items) {
        if (insertRecord) {
          const res = await insertRecord(record);
          if (res.ok) success++;
          else if (res.skipped) skipped++;
          else {
            error++;
            if (!firstError) firstError = `Row ${row}: ${res.error || 'could not be saved'}`;
          }
          continue;
        }

        const { error: dbError } = await supabase.from(tableName).insert([record]);
        if (dbError) {
          console.error('Row insert error:', dbError.message);
          if (!firstError) firstError = `Row ${row}: ${dbError.message}`;
          error++;
        } else {
          success++;
        }
      }
      report({ success, updated: 0, skipped, error, kept: 0, firstError });
    } catch (err: any) {
      showToast('Error processing file: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  // 3b. Preview: decide what would happen to every row, save nothing
  const handlePreview = async () => {
    if (!planRecord) return;
    if (!rawText.trim()) {
      showToast('Please upload a CSV file or paste data', 'error');
      return;
    }
    setImporting(true);
    try {
      const built = buildRecords();
      if (!built) return;
      const out: ImportPlan[] = [];
      for (const { row, record } of built.items) {
        const plan = await planRecord(record, out);
        out.push({ ...plan, row });
      }
      setPlanErrors(built.errors.filter(e => e.message).map(e => e.message as string));
      setPlanErrorCount(built.errors.length);
      setPlans(out);
    } catch (err: any) {
      showToast('Error processing file: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  // 3c. Confirm: carry out the previewed plans
  const handleConfirm = async () => {
    if (!plans || !applyPlan) return;
    setImporting(true);
    try {
      let success = 0, updated = 0, skipped = 0, kept = 0;
      let error = planErrorCount;
      let firstError = planErrors[0] ?? '';
      for (const p of plans) {
        kept += p.kept?.length || 0;
        if (p.action === 'infile') continue; // already combined into an earlier new trip
        if (p.action === 'unchanged') { skipped++; continue; }
        if (p.action === 'error') {
          error++;
          if (!firstError) firstError = `Row ${p.row}: ${p.message || 'could not be matched'}`;
          continue;
        }
        const res = await applyPlan(p);
        if (res.ok && res.updated) updated++;
        else if (res.ok) success++;
        else {
          error++;
          if (!firstError) firstError = `Row ${p.row}: ${res.error || 'could not be saved'}`;
        }
      }
      report({ success, updated, skipped, error, kept, firstError });
    } catch (err: any) {
      showToast('Error processing file: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const planCount = (a: ImportPlan['action']) => (plans || []).filter(p => p.action === a).length;
  const shortVal = (v: any) => { const t = String(v); return t.length > 28 ? t.slice(0, 27) + '…' : t; };
  const badge: Record<ImportPlan['action'], { label: string; cls: string }> = {
    insert: { label: 'New', cls: 'bg-emerald-100 text-emerald-700' },
    update: { label: 'Update', cls: 'bg-sky-100 text-sky-700' },
    unchanged: { label: 'Nothing new', cls: 'bg-slate-100 text-slate-600' },
    infile: { label: 'Combined', cls: 'bg-violet-100 text-violet-700' },
    error: { label: 'Problem', cls: 'bg-red-100 text-red-700' },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-fade-in p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h3 className="text-lg font-bold text-slate-800 uppercase tracking-wide">
              Bulk Import — {tableName.replace(/_/g, ' ')}
            </h3>
            <p className="text-xs text-slate-500">Download the template, fill it out, and upload your CSV or spreadsheet file.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          
          {/* Step 1: Download Template */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Step 1: Get Template</span>
              <p className="text-sm font-medium text-slate-700">Download our structured CSV template with required columns.</p>
            </div>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <Download className="h-4 w-4 text-slate-500" />
              Download Template
            </button>
          </div>

          {/* Step 2: Choose Upload or Paste Mode */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Step 2: Upload CSV File</span>
              <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-medium">
                <button
                  onClick={() => setMode('upload')}
                  className={`px-3 py-1 rounded-md transition-all ${mode === 'upload' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Upload File
                </button>
                <button
                  onClick={() => setMode('paste')}
                  className={`px-3 py-1 rounded-md transition-all ${mode === 'paste' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Paste Data
                </button>
              </div>
            </div>

            {mode === 'upload' ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-2 ${
                  fileName ? 'border-emerald-300 bg-emerald-50/30' : 'border-slate-300 hover:border-slate-400 bg-slate-50/50'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".csv,.txt"
                  className="hidden"
                />
                {fileName ? (
                  <>
                    <div className="h-10 w-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-800">{fileName}</p>
                    <p className="text-xs text-emerald-600 font-medium">Click or select another file to replace</p>
                  </>
                ) : (
                  <>
                    <div className="h-10 w-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
                      <Upload className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">Click to browse your computer for a CSV file</p>
                    <p className="text-xs text-slate-400">Supports standard .csv formatted spreadsheets</p>
                  </>
                )}
              </div>
            ) : (
              <div>
                <textarea
                  rows={5}
                  className="w-full font-mono text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                  placeholder={`${sampleColumns.join(',')}\nvalue1,value2,value3...`}
                  value={rawText}
                  onChange={e => { setRawText(e.target.value); setPlans(null); }}
                />
                <p className="text-xs text-slate-400 mt-1">Tip: You can also copy spreadsheet rows directly from Excel or Google Sheets and paste them here.</p>
              </div>
            )}
          </div>

          {/* Preview of what will happen (only for imports that merge into existing records) */}
          {plans && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Step 3: Check what will change</span>
              <div className="flex flex-wrap gap-3 text-xs font-semibold">
                <span className="text-emerald-700">{planCount('insert')} new</span>
                <span className="text-sky-700">{planCount('update')} to update</span>
                <span className="text-slate-500">{planCount('unchanged')} nothing new</span>
                {planCount('infile') > 0 && <span className="text-violet-700">{planCount('infile')} combined with an earlier row</span>}
                {(planCount('error') + planErrorCount) > 0 && <span className="text-red-600">{planCount('error') + planErrorCount} with problems (will be skipped)</span>}
              </div>
              {planErrors.length > 0 && (
                <div className="max-h-24 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 space-y-0.5">
                  {planErrors.slice(0, 30).map((m, i) => <p key={i}>{m}</p>)}
                </div>
              )}
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0">
                    <tr><th className="text-left p-2">Row</th><th className="text-left p-2">Trip</th><th className="text-left p-2">What happens</th></tr>
                  </thead>
                  <tbody>
                    {plans.slice(0, 300).map((p, i) => (
                      <tr key={i} className="border-t border-slate-100 align-top">
                        <td className="p-2 text-slate-500">{p.row}</td>
                        <td className="p-2 font-medium text-slate-700">{labelRecord ? labelRecord(p.record) : `${p.record.trip_date ?? ''}`}</td>
                        <td className="p-2 space-y-1">
                          <span className={`inline-block rounded px-1.5 py-0.5 font-semibold ${badge[p.action].cls}`}>{badge[p.action].label}</span>
                          {p.action === 'update' && p.patch && (
                            <p className="text-slate-600">Fills: {Object.entries(p.patch).map(([k, v]) => `${k.replace(/_/g, ' ')} = ${shortVal(v)}`).join('; ')}</p>
                          )}
                          {p.action === 'infile' && p.message && <p className="text-slate-500">{p.message}</p>}
                          {p.action === 'unchanged' && <p className="text-slate-500">Everything in this row is already saved.</p>}
                          {p.action === 'error' && <p className="text-red-600">{p.message}</p>}
                          {(p.kept?.length ?? 0) > 0 && (
                            <p className="text-amber-700">Kept saved value: {p.kept!.map(k => `${k.field.replace(/_/g, ' ')} (saved ${shortVal(k.saved)}, file ${shortVal(k.file)})`).join('; ')}</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plans.length > 300 && <p className="p-2 text-[11px] text-slate-400">Showing the first 300 of {plans.length} rows. All rows are imported when you confirm.</p>}
              </div>
              <p className="text-[11px] text-slate-500">Values that are already saved are never overwritten. Nothing is saved until you press Confirm.</p>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          {plans && <button onClick={() => setPlans(null)} disabled={importing} className="btn-secondary">Back</button>}
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={planRecord ? (plans ? handleConfirm : handlePreview) : handleImport}
            disabled={importing || !rawText.trim() || (!!plans && planCount('insert') + planCount('update') === 0)}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: portalColor }}
          >
            {importing ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {plans ? 'Importing...' : planRecord ? 'Checking...' : 'Importing...'}
              </>
            ) : plans ? (
              <>
                <FileText className="h-4 w-4" />
                Confirm Import ({planCount('insert') + planCount('update')})
              </>
            ) : planRecord ? (
              <>
                <Eye className="h-4 w-4" />
                Preview Changes
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                Import Records
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
