import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  iconColor: string;
  onAdd?: () => void;
  addLabel?: string;
  onUploadClick?: () => void;
  onDownloadTemplate?: () => void;
}

export function PageHeader({
  title,
  subtitle,
  icon,
  iconColor,
  onAdd,
  addLabel = 'Add New',
  onUploadClick,
  onDownloadTemplate,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center gap-4">
        <div 
          className="p-1.5 rounded-xl bg-white border border-slate-200 shadow-md flex items-center justify-center shrink-0 w-14 h-14 overflow-hidden"
        >
          <img src="/sal-logo.jpeg" alt="SAL" className="w-full h-full object-contain" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">{title}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
        {onDownloadTemplate && (
          <button
            onClick={onDownloadTemplate}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl shadow-sm transition-colors"
          >
            Download Template
          </button>
        )}
        {onUploadClick && (
          <button
            onClick={onUploadClick}
            className="px-3.5 py-2 text-xs font-semibold text-white rounded-xl shadow-sm transition-opacity hover:opacity-90"
            style={{ background: iconColor }}
          >
            Upload Excel
          </button>
        )}
        {onAdd && (
          <button
            onClick={onAdd}
            className="px-4 py-2 text-xs font-bold text-white rounded-xl shadow-sm transition-opacity hover:opacity-90 flex items-center gap-1.5"
            style={{ background: iconColor }}
          >
            <span>+</span> {addLabel}
          </button>
        )}
      </div>
    </div>
  );
}
