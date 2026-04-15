import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, Pill, Check } from 'lucide-react';

interface DrugEntry {
  id: string;
  name: string;
  generic_name: string | null;
  dosage_form: string;
  strength: string | null;
  requires_prescription: boolean;
  common_dosage_instructions: string | null;
  default_dosage_frequency: string | null;
  default_dosage_duration_days: number | null;
  default_quantity_per_dose: number | null;
  category_id: string | null;
  image_url: string | null;
}

interface DrugSearchDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (drug: DrugEntry) => void;
  onManualAdd?: () => void;
}

export function DrugSearchDialog({ open, onClose, onSelect }: DrugSearchDialogProps) {
  const [search, setSearch] = useState('');
  const [drugs, setDrugs] = useState<DrugEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchDrugs();
  }, [open]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (open) fetchDrugs();
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const fetchDrugs = async () => {
    setLoading(true);
    let query = supabase.from('drug_database').select('id, name, generic_name, dosage_form, strength, requires_prescription, common_dosage_instructions, default_dosage_frequency, default_dosage_duration_days, default_quantity_per_dose, category_id, image_url').eq('is_active', true).order('name').limit(50);
    if (search) {
      query = query.or(`name.ilike.%${search}%,generic_name.ilike.%${search}%`);
    }
    const { data } = await query;
    setDrugs(data || []);
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Pill className="w-5 h-5" /> Search Drug Database</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by drug name..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" autoFocus />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border">
          {drugs.length === 0 && !loading && (
            <div className="text-center py-8 text-muted-foreground">
              <p>No drugs found. You can add it manually.</p>
            </div>
          )}
          {drugs.map(drug => (
            <button key={drug.id} className="w-full text-left p-3 hover:bg-secondary/50 transition-colors flex items-center gap-3" onClick={() => { onSelect(drug); onClose(); }}>
              <div className="w-12 h-12 rounded-lg bg-secondary overflow-hidden shrink-0">
                {drug.image_url ? (
                  <img src={drug.image_url} alt={drug.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"><Pill className="w-5 h-5 text-muted-foreground" /></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-foreground">{drug.name}</span>
                  {drug.strength && <Badge variant="outline" className="text-xs">{drug.strength}</Badge>}
                  <Badge variant="secondary" className="text-xs">{drug.dosage_form}</Badge>
                  {drug.requires_prescription && <Badge variant="destructive" className="text-xs">Rx</Badge>}
                </div>
                {drug.generic_name && <p className="text-xs text-muted-foreground">{drug.generic_name}</p>}
              </div>
            </button>
          ))}
        </div>
        <Button variant="outline" onClick={onClose} className="mt-2">
          <Pill className="w-4 h-4 mr-2" />
          Drug not listed? Add Manually
        </Button>
      </DialogContent>
    </Dialog>
  );
}
