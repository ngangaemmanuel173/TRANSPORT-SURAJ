import { useState, useRef } from 'react';
import { X, Download, Upload, FileText, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/Toast';
import { SubAccount } from '@/lib/portals';

interface BulkImportModalProps {
  open: boolean;
  onClose: () => void;
  tableName: string;
  portalColor: string;
  subAccount: SubAccount;
  sampleColumns: string[];
  onSuccess: () => void;
}

export function BulkImportModal({
  open,
  onClose,
  tableName,
  portalColor,
  subAccount,
  sampleColumns,
  onSuccess,
}: BulkImportModalProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState('');
  const [mode, setMode] = useState<'upload' | 'paste'>('upload');

  if (!open) return null;

  // 1. Download CSV Template
  const downloadTemplate = () => {
    const headerRow = sampleColumns.join(',');
    const sampleRow = sampleColumns.map(() => 'sample_value').join(',');
    const csvContent = `data:text/csv;charset=utf-8,${headerRow}\n${sampleRow}`;
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
    'trip_date', 'fuel_date', 'sub_account', 'mcl_area_id', 'departure_point',
    'arrival_point', 'destination_city', 'trailer_number', 'status', 'notes',
    'vehicle_id', 'driver_id',
  ]);

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

  // 3. Parse and Insert Data into Supabase with Data Sanitization
  const handleImport = async () => {
    if (!rawText.trim()) {
      showToast('Please upload a CSV file or paste data', 'error');
      return;
    }

    setImporting(true);
    try {
      const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        showToast('CSV file is empty or missing data rows', 'error');
        setImporting(false);
        return;
      }

      // Support comma or tab separation
      const delimiter = lines[0].includes('\t') ? '\t' : ',';
      const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
      let successCount = 0;
      let errorCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ''));
        const record: Record<string, any> = {
          sub_account: subAccount,
        };

        headers.forEach((header, index) => {
          if (!header) return;
          const rawVal = values[index];

          if (isNumericHeader(header)) {
            // Convert numbers safely, default to 0 for invalid/empty entries or letter artifacts
            if (rawVal === undefined || rawVal === '' || isNaN(Number(rawVal))) {
              record[header] = 0;
            } else {
              record[header] = Number(rawVal);
            }
          } else {
            // Handle text or category codes
            if (rawVal !== undefined && rawVal !== '') {
              record[header] = rawVal;
            } else {
              record[header] = null;
            }
          }
        });

        // Skip row if no actual values were assigned beyond sub_account
        if (Object.keys(record).length <= 1) continue;

        const { error } = await supabase.from(tableName).insert([record]);
        if (error) {
          console.error('Row insert error:', error.message);
          errorCount++;
        } else {
          successCount++;
        }
      }

      if (successCount > 0) {
        showToast(`Successfully imported ${successCount} record(s)${errorCount > 0 ? `, ${errorCount} failed` : ''}`, 'success');
        onSuccess();
        onClose();
      } else {
        showToast('Import failed. Check your file formatting and columns.', 'error');
      }
    } catch (err: any) {
      showToast('Error processing file: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
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
                  onChange={e => setRawText(e.target.value)}
                />
                <p className="text-xs text-slate-400 mt-1">Tip: You can also copy spreadsheet rows directly from Excel or Google Sheets and paste them here.</p>
              </div>
            )}
          </div>

        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={importing || !rawText.trim()}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: portalColor }}
          >
            {importing ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Importing...
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
