import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/components/Toast';
import { Upload, FileSpreadsheet, X, CheckCircle2 } from 'lucide-react';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  subAccount: string;
  onSuccess?: () => void;
}

export function UploadModal({ isOpen, onClose, tableName, subAccount, onSuccess }: UploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const { showToast } = useToast();

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.SheetNames[0];
          const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);

          if (rawRows.length === 0) {
            showToast('The uploaded spreadsheet contains no data rows.', 'error');
            setUploading(false);
            return;
          }

          const DEDICATED_TRIP_TABLES = ['mcl_trips', 'csl_trips', 'tarmal_trips', 'pn_mashru_trips'];
          const preparedRows = DEDICATED_TRIP_TABLES.includes(tableName)
            ? rawRows
            : rawRows.map((row: any) => ({
                ...row,
                sub_account: subAccount,
                created_at: new Date().toISOString()
              }));

          const { error } = await supabase.from(tableName).insert(preparedRows);
          if (error) throw error;

          showToast(`Successfully imported ${preparedRows.length} records!`, 'success');
          if (onSuccess) onSuccess();
          onClose();
        } catch (err: any) {
          showToast(err.message || 'Failed to parse and insert data records.', 'error');
        } finally {
          setUploading(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err: any) {
      showToast('Error reading uploaded file.', 'error');
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Upload className="h-5 w-5 text-blue-600" />
            Upload & Auto-Import Data
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 rounded-lg p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="py-6 space-y-4">
          <label className="flex flex-col items-center justify-center w-full h-36 border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100/80 transition-all">
            <FileSpreadsheet className="h-8 w-8 text-blue-500 mb-2" />
            <span className="text-xs font-semibold text-slate-700">
              {file ? file.name : 'Select or drop Excel/CSV file here'}
            </span>
            <span className="text-[10px] text-slate-400 mt-1">Supports .xlsx, .xls, .csv</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
          </label>

          {file && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between text-xs text-blue-700">
              <span className="font-mono truncate">{file.name}</span>
              <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800">
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
          >
            {uploading ? 'Parsing & Importing...' : 'Import Data'}
          </button>
        </div>
      </div>
    </div>
  );
}
