import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categoryId: string;
  onDone: () => void;
}

interface Row { code: string; value: number }

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const codeIdx = header.indexOf('code');
  const valueIdx = header.indexOf('value');
  const startIdx = codeIdx >= 0 && valueIdx >= 0 ? 1 : 0;
  const useHeader = codeIdx >= 0 && valueIdx >= 0;
  const rows: Row[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const parts = lines[i].split(',').map(p => p.trim());
    const code = useHeader ? parts[codeIdx] : parts[0];
    const value = Number(useHeader ? parts[valueIdx] : parts[1]);
    if (code && Number.isFinite(value)) rows.push({ code, value });
  }
  return rows;
}

export function CsvUploadDialog({ open, onOpenChange, categoryId, onDone }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) throw new Error('No valid rows found. Use columns: code,value');
      const payload = rows.map(r => ({ category_id: categoryId, code: r.code, value: r.value }));
      const { error } = await supabase.from('voucher_codes').insert(payload);
      if (error) throw error;
      toast({ title: `${rows.length} vouchers uploaded` });
      onDone();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk upload voucher codes</DialogTitle>
          <DialogDescription>
            CSV format: <code className="text-xs">code,value</code>. First row can be a header.
          </DialogDescription>
        </DialogHeader>
        <label className="border-2 border-dashed border-border rounded-lg h-40 flex flex-col items-center justify-center cursor-pointer hover:bg-muted/40 transition">
          {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : (
            <>
              <Upload className="w-6 h-6 mb-2 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Click to select CSV file</span>
            </>
          )}
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }} />
        </label>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
      </DialogContent>
    </Dialog>
  );
}
