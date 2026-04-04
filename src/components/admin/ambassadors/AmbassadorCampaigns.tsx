import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Megaphone } from 'lucide-react';

export function AmbassadorCampaigns() {
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [ambassadors, setAmbassadors] = useState<any[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ ambassador_id: '', campaign_name: '', payment_amount: '', start_date: '', end_date: '', deliverables: '' });

  const fetchData = async () => {
    const [{ data: c }, { data: a }] = await Promise.all([
      supabase.from('ambassador_campaigns').select('*, ambassadors(name)').order('created_at', { ascending: false }),
      supabase.from('ambassadors').select('id, name').eq('is_active', true),
    ]);
    setCampaigns(c || []);
    setAmbassadors(a || []);
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    if (!form.ambassador_id || !form.campaign_name) {
      toast({ title: 'Ambassador and campaign name required', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('ambassador_campaigns').insert({
      ambassador_id: form.ambassador_id,
      campaign_name: form.campaign_name,
      payment_amount: Number(form.payment_amount) || 0,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      deliverables: form.deliverables || null,
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Campaign created!' });
      setCreateOpen(false);
      setForm({ ambassador_id: '', campaign_name: '', payment_amount: '', start_date: '', end_date: '', deliverables: '' });
      fetchData();
    }
  };

  const statusColor = (s: string) => s === 'active' ? 'default' : s === 'completed' ? 'secondary' : 'destructive';

  return (
    <Card className="border-0 shadow-soft">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Megaphone className="w-5 h-5" /> Paid Campaigns</CardTitle>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> New Campaign</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Paid Campaign</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Ambassador *</Label>
                  <Select value={form.ambassador_id} onValueChange={v => setForm(f => ({ ...f, ambassador_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      {ambassadors.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Campaign Name *</Label><Input value={form.campaign_name} onChange={e => setForm(f => ({ ...f, campaign_name: e.target.value }))} /></div>
                <div><Label>Payment Amount (₦)</Label><Input type="number" value={form.payment_amount} onChange={e => setForm(f => ({ ...f, payment_amount: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                  <div><Label>End Date</Label><Input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
                </div>
                <div><Label>Deliverables</Label><Textarea value={form.deliverables} onChange={e => setForm(f => ({ ...f, deliverables: e.target.value }))} placeholder="e.g. 3 Instagram posts, 1 TikTok video" /></div>
                <Button className="w-full" onClick={handleCreate}>Create Campaign</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {campaigns.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No campaigns yet</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Ambassador</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.campaign_name}</TableCell>
                  <TableCell>{c.ambassadors?.name || '—'}</TableCell>
                  <TableCell>₦{Number(c.payment_amount).toLocaleString()}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.start_date || '—'} → {c.end_date || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusColor(c.status)}>{c.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
