import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Ticket, Trash2, Upload, Wallet, Package } from 'lucide-react';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { useAuth } from '@/hooks/useAuth';
import { useVendorResolver } from '@/hooks/useVendorResolver';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useVoucherCategories, useVoucherCodes, useVendorTemplate } from '@/hooks/useVoucherHub';
import { ImageUploadField } from '@/components/admin/ImageUploadField';
import { CsvUploadDialog } from '@/components/vendor/voucher/CsvUploadDialog';
import { VoucherPreview } from '@/components/vouchers/VoucherPreview';

const VALIDITY_PRESETS = [
  { label: '1 week', days: 7 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: 'Custom', days: 0 },
];

export default function VendorVoucherHub() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { vendorId, loading: vendorLoading } = useVendorResolver();
  const [vendorName, setVendorName] = useState<string>('My Store');
  const [vendorSlug, setVendorSlug] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [salesStats, setSalesStats] = useState({ totalSold: 0, totalRevenue: 0 });

  const { categories, refetch: refetchCategories } = useVoucherCategories(vendorId);
  const { template, refetch: refetchTemplate, setTemplate } = useVendorTemplate(vendorId);

  useEffect(() => {
    if (!vendorId) return;
    supabase.from('vendors').select('name, slug, user_id').eq('id', vendorId).maybeSingle()
      .then(async ({ data }) => {
        if (data?.name) setVendorName(data.name);
        if (data?.slug) setVendorSlug(data.slug);
        if (data?.user_id) {
          const { data: w } = await supabase
            .from('wallets')
            .select('balance, test_balance')
            .eq('user_id', data.user_id)
            .eq('wallet_type', 'vendor')
            .maybeSingle();
          const { data: env } = await supabase
            .from('platform_settings').select('value').eq('key', 'platform_environment').maybeSingle();
          const isTest = (env?.value || 'development') === 'development';
          setWalletBalance(Number((isTest ? (w as any)?.test_balance : (w as any)?.balance) || 0));
        }
      });
    supabase.from('voucher_orders').select('amount').eq('vendor_id', vendorId).eq('status', 'paid')
      .then(({ data }) => {
        const rows = data || [];
        setSalesStats({
          totalSold: rows.length,
          totalRevenue: rows.reduce((s, r: any) => s + Number(r.amount), 0),
        });
      });
  }, [vendorId, categories.length]);

  if (authLoading || vendorLoading) {
    return <VendorLayout><div className="p-6">Loading…</div></VendorLayout>;
  }
  if (!user) { navigate('/vendor/auth'); return null; }
  if (!vendorId) return <VendorLayout><div className="p-6">No vendor account found.</div></VendorLayout>;

  return (
    <VendorLayout vendorName={vendorName} vendorId={vendorId}>
      <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Ticket className="w-6 h-6" /> Voucher Hub</h1>
          <p className="text-sm text-muted-foreground">Sell data, WiFi and other digital vouchers to FastCalories customers.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardContent className="p-4 flex items-center gap-3"><Package className="w-8 h-8 text-primary" /><div><p className="text-xs text-muted-foreground">Vouchers sold</p><p className="text-xl font-bold">{salesStats.totalSold}</p></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><Ticket className="w-8 h-8 text-primary" /><div><p className="text-xs text-muted-foreground">Revenue</p><p className="text-xl font-bold">₦{salesStats.totalRevenue.toLocaleString()}</p></div></CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3"><Wallet className="w-8 h-8 text-primary" /><div><p className="text-xs text-muted-foreground">Wallet balance</p><p className="text-xl font-bold">₦{walletBalance.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">Credits arrive in Phase 2</p></div></CardContent></Card>
        </div>

        <Tabs defaultValue="categories" className="w-full">
          <TabsList>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="template">Template</TabsTrigger>
            <TabsTrigger value="sales">Sales</TabsTrigger>
          </TabsList>

          <TabsContent value="categories" className="mt-4">
            <CategoriesTab vendorId={vendorId} categories={categories} refetch={refetchCategories} />
          </TabsContent>
          <TabsContent value="stock" className="mt-4">
            <StockTab categories={categories} />
          </TabsContent>
          <TabsContent value="template" className="mt-4">
            <TemplateTab vendorId={vendorId} vendorName={vendorName} template={template} refetch={refetchTemplate} setTemplate={setTemplate} />
          </TabsContent>
          <TabsContent value="sales" className="mt-4">
            <SalesTab vendorId={vendorId} categories={categories} />
          </TabsContent>
        </Tabs>
      </div>
    </VendorLayout>
  );
}

function CategoriesTab({ vendorId, categories, refetch }: { vendorId: string; categories: any[]; refetch: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState('30');
  const [customDays, setCustomDays] = useState(30);

  const save = async () => {
    if (!name.trim()) return;
    const days = preset === '0' ? customDays : Number(preset);
    if (days <= 0) return;
    const { error } = await supabase.from('voucher_categories').insert({ vendor_id: vendorId, name: name.trim(), validity_days: days });
    if (error) return toast({ title: error.message, variant: 'destructive' });
    toast({ title: 'Category created' });
    setName(''); setPreset('30'); setOpen(false);
    refetch();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this category and all its codes?')) return;
    await supabase.from('voucher_categories').delete().eq('id', id);
    refetch();
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from('voucher_categories').update({ is_active: !current }).eq('id', id);
    refetch();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between"><CardTitle>Voucher categories</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" /> New category</Button></DialogTrigger>
          <DialogContent><DialogHeader><DialogTitle>New voucher category</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input placeholder="e.g. MTN Data" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Validity</Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{VALIDITY_PRESETS.map(p => <SelectItem key={p.days} value={String(p.days)}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {preset === '0' && <div><Label>Custom days</Label><Input type="number" min={1} value={customDays} onChange={(e) => setCustomDays(Number(e.target.value))} /></div>}
              <Button onClick={save} className="w-full">Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {categories.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No categories yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Validity</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {categories.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.validity_days} days</TableCell>
                  <TableCell><Badge variant={c.is_active ? 'default' : 'secondary'}>{c.is_active ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="ghost" onClick={() => toggleActive(c.id, c.is_active)}>{c.is_active ? 'Disable' : 'Enable'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="w-4 h-4" /></Button>
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

function StockTab({ categories }: { categories: any[] }) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string>(categories[0]?.id || '');
  useEffect(() => { if (!selectedId && categories[0]) setSelectedId(categories[0].id); }, [categories, selectedId]);
  const { codes, refetch } = useVoucherCodes(selectedId || null);
  const [code, setCode] = useState('');
  const [value, setValue] = useState<number>(0);
  const [csvOpen, setCsvOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'sold' | 'expired'>('all');

  const filtered = useMemo(() => statusFilter === 'all' ? codes : codes.filter(c => c.status === statusFilter), [codes, statusFilter]);

  const addManual = async () => {
    if (!selectedId || !code.trim() || value <= 0) return;
    const { error } = await supabase.from('voucher_codes').insert({ category_id: selectedId, code: code.trim(), value });
    if (error) return toast({ title: error.message, variant: 'destructive' });
    toast({ title: 'Voucher added' });
    setCode(''); setValue(0);
    refetch();
  };

  const remove = async (id: string) => {
    await supabase.from('voucher_codes').delete().eq('id', id);
    refetch();
  };

  if (categories.length === 0) return <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Create a category first.</CardContent></Card>;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Choose category" /></SelectTrigger>
            <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="sold">Sold</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setCsvOpen(true)}><Upload className="w-4 h-4 mr-1" /> CSV upload</Button>
        </div>
        <div className="flex flex-wrap items-end gap-2 border-t pt-3">
          <div className="flex-1 min-w-[180px]"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Voucher code" /></div>
          <div className="w-32"><Label>Value (₦)</Label><Input type="number" min={0} value={value || ''} onChange={(e) => setValue(Number(e.target.value))} /></div>
          <Button onClick={addManual}><Plus className="w-4 h-4 mr-1" /> Add</Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-2">
          {codes.filter(c => c.status === 'available').length} available · {codes.filter(c => c.status === 'sold').length} sold
        </p>
        {filtered.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No codes.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Value</TableHead><TableHead>Status</TableHead><TableHead>Added</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.slice(0, 200).map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.code}</TableCell>
                  <TableCell>₦{Number(c.value).toLocaleString()}</TableCell>
                  <TableCell><Badge variant={c.status === 'available' ? 'default' : 'secondary'}>{c.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    {c.status === 'available' && <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="w-4 h-4" /></Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {selectedId && <CsvUploadDialog open={csvOpen} onOpenChange={setCsvOpen} categoryId={selectedId} onDone={refetch} />}
    </Card>
  );
}

function TemplateTab({ vendorId, vendorName, template, refetch, setTemplate }: any) {
  const { toast } = useToast();
  const [bgMode, setBgMode] = useState<'color' | 'image'>(template?.background_image_url ? 'image' : 'color');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!template) return;
    setSaving(true);
    const payload = {
      vendor_id: vendorId,
      logo_url: template.logo_url,
      background_color: bgMode === 'color' ? (template.background_color || '#0F172A') : null,
      background_image_url: bgMode === 'image' ? template.background_image_url : null,
    };
    const { error } = await supabase.from('vendor_templates').upsert(payload, { onConflict: 'vendor_id' });
    setSaving(false);
    if (error) return toast({ title: error.message, variant: 'destructive' });
    toast({ title: 'Template saved' });
    refetch();
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle>Brand template</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <ImageUploadField label="Store logo" value={template?.logo_url || ''} onChange={(url) => setTemplate({ ...template, logo_url: url })} folder="voucher-templates" />
          <div>
            <Label>Background</Label>
            <div className="flex gap-2 mt-1">
              <Button size="sm" variant={bgMode === 'color' ? 'default' : 'outline'} onClick={() => setBgMode('color')}>Color</Button>
              <Button size="sm" variant={bgMode === 'image' ? 'default' : 'outline'} onClick={() => setBgMode('image')}>Image</Button>
            </div>
          </div>
          {bgMode === 'color' ? (
            <div>
              <Label>Background color</Label>
              <div className="flex gap-2 items-center mt-1">
                <input type="color" value={template?.background_color || '#0F172A'} onChange={(e) => setTemplate({ ...template, background_color: e.target.value })} className="h-10 w-16 rounded" />
                <Input value={template?.background_color || ''} onChange={(e) => setTemplate({ ...template, background_color: e.target.value })} />
              </div>
            </div>
          ) : (
            <ImageUploadField label="Background image" value={template?.background_image_url || ''} onChange={(url) => setTemplate({ ...template, background_image_url: url })} folder="voucher-backgrounds" />
          )}
          <Button onClick={save} disabled={saving} className="w-full">{saving ? 'Saving…' : 'Save template'}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Live preview</CardTitle></CardHeader>
        <CardContent className="flex justify-center">
          <VoucherPreview
            vendorName={vendorName}
            vendorLogoUrl={template?.logo_url}
            categoryName="Sample Category"
            code="SAMPLE-CODE-1234"
            expiryDate={new Date(Date.now() + 30 * 86400000)}
            purchasedAt={new Date()}
            backgroundColor={bgMode === 'color' ? template?.background_color : null}
            backgroundImageUrl={bgMode === 'image' ? template?.background_image_url : null}
            amount={5000}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SalesTab({ vendorId, categories }: { vendorId: string; categories: any[] }) {
  const [perCategory, setPerCategory] = useState<Record<string, { sold: number; available: number }>>({});

  useEffect(() => {
    if (!vendorId || categories.length === 0) return;
    const load = async () => {
      const ids = categories.map(c => c.id);
      const { data: codes } = await supabase.from('voucher_codes').select('category_id, status').in('category_id', ids);
      const map: Record<string, { sold: number; available: number }> = {};
      categories.forEach(c => { map[c.id] = { sold: 0, available: 0 }; });
      (codes || []).forEach((c: any) => {
        if (!map[c.category_id]) map[c.category_id] = { sold: 0, available: 0 };
        if (c.status === 'sold') map[c.category_id].sold++;
        if (c.status === 'available') map[c.category_id].available++;
      });
      setPerCategory(map);
    };
    load();
  }, [vendorId, categories]);

  return (
    <Card>
      <CardHeader><CardTitle>Sales & stock by category</CardTitle></CardHeader>
      <CardContent>
        {categories.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">No categories yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Sold</TableHead><TableHead>Remaining</TableHead></TableRow></TableHeader>
            <TableBody>
              {categories.map(c => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{perCategory[c.id]?.sold ?? 0}</TableCell>
                  <TableCell>{perCategory[c.id]?.available ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
