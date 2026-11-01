import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle2, X, AlertCircle, Info } from 'lucide-react';

type Toast = { id: number; message: string; type: 'success' | 'error' | 'info' };

const ToastContext = createContext<{ showToast: (message: string, type?: Toast['type']) => void } | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  }, []);

  const dismiss = (id: number) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg animate-fade-in ${
              t.type === 'success' ? 'bg-emerald-600 text-white'
              : t.type === 'error' ? 'bg-red-600 text-white'
              : 'bg-slate-800 text-white'
            }`}
          >
            {t.type === 'success' && <CheckCircle2 className="h-5 w-5 shrink-0" />}
            {t.type === 'error' && <AlertCircle className="h-5 w-5 shrink-0" />}
            {t.type === 'info' && <Info className="h-5 w-5 shrink-0" />}
            <span className="text-sm font-medium flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-70 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
