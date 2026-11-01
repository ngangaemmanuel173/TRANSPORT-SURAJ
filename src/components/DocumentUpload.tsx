import { useState, useRef } from 'react';
import { Paperclip, Trash2, ExternalLink, Loader2, Upload } from 'lucide-react';
import { uploadDocument, deleteDocument, getFileName } from '@/lib/upload';
import { useAuth } from '@/lib/auth';

interface Props {
  folder: string;
  recordId: string;
  existingDocs: string[];
  onDocsChange: (docs: string[]) => void;
  readOnly?: boolean;
}

export function DocumentUpload({ 
  folder, 
  recordId, 
  existingDocs, 
  onDocsChange,
  readOnly = false 
}: Props) {
  const { profile } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const canDelete = 
    profile?.role === 'manager' || 
    profile?.role === 'corporate_admin';

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

   const allowed = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
];
    if (!allowed.includes(file.type)) {
      setError('Only PDF, JPG and PNG files are allowed.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10MB.');
      return;
    }

    setUploading(true);
    setError(null);
    setProgress(40);

    const { url, error: uploadError } = await uploadDocument(
      file, 
      folder, 
      recordId || 'unsaved'
    );

    setProgress(100);
    setUploading(false);

    if (uploadError || !url) {
      setError(uploadError || 'Upload failed.');
      setProgress(0);
      return;
    }

    onDocsChange([...existingDocs, url]);
    setProgress(0);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDelete = async (url: string) => {
    if (!window.confirm('Remove this document?')) return;
    const { error: deleteError } = await deleteDocument(url);
    if (deleteError) {
      setError(deleteError);
      return;
    }
    onDocsChange(existingDocs.filter(d => d !== url));
  };

  return (
    <div className="mt-4 pt-4 border-t border-slate-200">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        Attachments
      </p>

      {/* Existing files */}
      {existingDocs.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {existingDocs.map((url) => (
            <div 
              key={url} 
              className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
            >
              <Paperclip className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline flex-1 truncate flex items-center gap-1"
              >
                {getFileName(url)}
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
              </a>
              {canDelete && !readOnly && (
                <button
                  type="button"
                  onClick={() => handleDelete(url)}
                  className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {existingDocs.length === 0 && (
        <p className="text-xs text-slate-400 mb-2">No attachments yet.</p>
      )}

      {/* Progress bar */}
      {uploading && (
        <div className="mb-3">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Uploading...
          </div>
          <div className="w-full bg-slate-200 rounded-full h-1.5">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-500 mb-2 flex items-center gap-1">
          ⚠ {error}
        </p>
      )}

      {/* Upload button */}
      {!readOnly && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:border-blue-400 hover:text-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="h-3.5 w-3.5" />
          Attach Document
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls"
        onChange={handleUpload}
        className="hidden"
      />
    </div>
  );
}
