import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface UniversalUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function UniversalUploadModal({ isOpen, onClose, onSuccess }: UniversalUploadModalProps) {
  const [uploading, setUploading] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleUniversalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setLog([`Reading file: ${file.name}...`]);

    try {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

      if (lines.length < 2) {
        setLog(prev => [...prev, 'Error: File is empty or invalid format.']);
        setUploading(false);
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      setLog(prev => [...prev, `Detected headers: ${headers.join(', ')}`]);

      // --- 1. SPARE PARTS & INVENTORY ROUTING ---
      if (headers.some(h => h.includes('part') || h.includes('item') || h.includes('tyre') || h.includes('battery') || h.includes('spare'))) {
        setLog(prev => [...prev, 'Auto-routed to -> Spare Parts Inventory...']);
        
        let count = 0;
        const { data: allParts } = await supabase.from('spare_parts').select('id, name, quantity');

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: any = {};
          headers.forEach((h, idx) => row[h] = values[idx]);

          const rawPartName = row['part_name'] || row['name'] || row['item'] || row['spare_part'] || row['part'] || '';
          const partName = rawPartName.trim();
          const qtyUsed = Number(row['quantity_used'] || row['qty'] || row['quantity'] || row['used'] || 0);

          if (!partName) continue;

          const normalizedSearch = partName.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');
          const existingPart = allParts?.find(p => {
            const dbName = p.name.trim().toLowerCase();
            const dbNormalized = dbName.replace(/ies$/, 'y').replace(/s$/, '');
            return dbName === partName.toLowerCase() || 
                   dbNormalized.includes(normalizedSearch) || 
                   normalizedSearch.includes(dbNormalized);
          });

          if (existingPart) {
            const newQty = Math.max(0, existingPart.quantity - qtyUsed);
            const { error } = await supabase.from('spare_parts').update({ quantity: newQty }).eq('id', existingPart.id);
            if (!error) {
              count++;
              existingPart.quantity = newQty;
              setLog(prev => [...prev, `[Spare Parts] "${partName}" updated -> Qty: ${newQty}`]);
            }
          }
        }
        setLog(prev => [...prev, `Successfully processed ${count} spare parts record(s)!`]);

      } 
      // --- 2. TRIPS & DISPATCH ROUTING ---
      else if (headers.some(h => h.includes('trip') || h.includes('route') || h.includes('destination') || h.includes('dispatch'))) {
        setLog(prev => [...prev, 'Auto-routed to -> Trips & Dispatch...']);
        
        let count = 0;
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: any = {};
          headers.forEach((h, idx) => row[h] = values[idx]);

          const destination = row['destination'] || row['route'] || row['trip'] || '';
          const vehiclePlate = row['vehicle_plate'] || row['plate'] || '';

          if (!destination) continue;

          const { error } = await supabase.from('trips').insert({
            destination,
            vehicle_plate: vehiclePlate || null,
            status: 'pending'
          });

          if (!error) {
            count++;
            setLog(prev => [...prev, `[Trips] Imported route to ${destination}`]);
          }
        }
        setLog(prev => [...prev, `Successfully imported ${count} trip(s)!`]);

      } 
      // --- 3. DRIVERS ROUTING ---
      else if (headers.some(h => h.includes('driver') || h.includes('license') || h.includes('badge'))) {
        setLog(prev => [...prev, 'Auto-routed to -> Drivers Management...']);
        
        let count = 0;
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const row: any = {};
          headers.forEach((h, idx) => row[h] = values[idx]);

          const driverName = row['driver_name'] || row['name'] || row['driver'] || '';
          const phone = row['phone'] || row['contact'] || '';

          if (!driverName) continue;

          const { error } = await supabase.from('drivers').insert({
            name: driverName,
            phone: phone || null
          });

          if (!error) {
            count++;
            setLog(prev => [...prev, `[Drivers] Added driver ${driverName}`]);
          }
        }
        setLog(prev => [...prev, `Successfully imported ${count} driver record(s)!`]);

      } else {
        setLog(prev => [...prev, 'Unrecognized file headers. Ensure CSV matches spare parts, trips, or drivers.']);
      }

      setTimeout(() => {
        onSuccess();
      }, 2000);

    } catch (err: any) {
      setLog(prev => [...prev, `Error processing file: ${err.message}`]);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl space-y-4">
        <div className="flex justify-between items-center border-b pb-3">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Upload className="h-5 w-5 text-blue-600" /> Universal Document Auto-Router
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-slate-600">
          Upload any file or CSV. The system will automatically detect the data type based on its columns and route it to the correct page and database table.
        </p>

        <div 
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-500 transition-colors bg-slate-50"
        >
          <FileSpreadsheet className="h-10 w-10 text-blue-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-700">Click to upload document or CSV</p>
          <p className="text-xs text-slate-400 mt-1">Auto-routes to Spare Parts, Trips, or Drivers</p>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleUniversalUpload} 
            accept=".csv,.txt,.xlsx" 
            className="hidden" 
          />
        </div>

        {log.length > 0 && (
          <div className="bg-slate-900 text-slate-200 rounded-xl p-3 text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
            {log.map((entry, idx) => (
              <div key={idx}>
                <span>{entry}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn-secondary text-sm">Close</button>
        </div>
      </div>
    </div>
  );
}
