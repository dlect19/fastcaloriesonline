import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Ticket, Trash2, Upload, Wallet, Package, Pencil, Check, X } from 'lucide-react';
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
          <Card><CardContent className="p-4 flex items-center gap-3"><Wallet className="w-8 h-8 text-primary" /><div><p className="text-xs text-muted-foreground">Wallet balance</p><p className="text-xl font-bold">₦{walletBalance.toLocaleString()}</p><p className="text-[10px] text-muted-foreground">Withdraw via the standard vendor payout flow.</p></div></CardContent></Card>
        </div>

        {vendorSlug && (
          <Card>
            <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">Public storefront (no login required)</p>
                <p className="text-sm font-mono truncate">{window.location.origin}/v/{vendorSlug}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/v/${vendorSlug}`);
                  toast({ title: 'Link copied', description: 'Share this link with your customers.' });
                }}
              >Copy link</Button>
              <Button onClick={() => window.open(`/v/${vendorSlug}`, '_blank')}>Open</Button>
            </CardContent>
          </Card>
        )}


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
  const [editing, setEditing] = useState<any | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [preset, setPreset] = useState('30');
  const [customDays, setCustomDays] = useState(30);

  const openNew = () => {
    setEditing(null);
    setName(''); setDescription(''); setPreset('30'); setCustomDays(30);
    setOpen(true);
  };
  const openEdit = (c: any) => {
    setEditing(c);
    setName(c.name);
    setDescription(c.description || '');
    const matched = VALIDITY_PRESETS.find(p => p.days === c.validity_days);
    if (matched && matched.days !== 0) { setPreset(String(matched.days)); }
    else { setPreset('0'); setCustomDays(c.validity_days); }
    setOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return;
    const days = preset === '0' ? customDays : Number(preset);
    if (days <= 0) return;
    const payload = { name: name.trim(), description: description.trim() || null, validity_days: days };
    if (editing) {
      const { error } = await supabase.from('voucher_categories').update(payload).eq('id', editing.id);
      if (error) return toast({ title: error.message, variant: 'destructive' });
      toast({ title: 'Category updated' });
    } else {
      const { error } = await supabase.from('voucher_categories').insert({ vendor_id: vendorId, ...payload });
      if (error) return toast({ title: error.message, variant: 'destructive' });
      toast({ title: 'Category created' });
    }
    setName(''); setDescription(''); setPreset('30'); setOpen(false); setEditing(null);
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
        <Button size="sm" onClick={openNew}><Plus className="w-4 h-4 mr-1" /> New category</Button>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogContent><DialogHeader><DialogTitle>{editing ? 'Edit voucher category' : 'New voucher category'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input placeholder="e.g. MTN Data" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>Description (optional)</Label><Input placeholder="e.g. 1GB valid for 30 days" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div><Label>Validity</Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{VALIDITY_PRESETS.map(p => <SelectItem key={p.days} value={String(p.days)}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {preset === '0' && <div><Label>Custom days</Label><Input type="number" min={1} value={customDays} onChange={(e) => setCustomDays(Number(e.target.value))} /></div>}
              <Button onClick={save} className="w-full">{editing ? 'Save changes' : 'Create'}</Button>
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
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)}><Pencil className="w-4 h-4" /></Button>
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editValue, setEditValue] = useState<number>(0);
  const startEdit = (c: any) => { setEditingId(c.id); setEditCode(c.code); setEditValue(Number(c.value)); };
  const cancelEdit = () => { setEditingId(null); setEditCode(''); setEditValue(0); };
  const saveEdit = async (id: string) => {
    if (!editCode.trim() || editValue <= 0) return;
    const { error } = await supabase.from('voucher_codes').update({ code: editCode.trim(), value: editValue }).eq('id', id);
    if (error) return toast({ title: error.message, variant: 'destructive' });
    toast({ title: 'Voucher updated' });
    cancelEdit();
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
              {filtered.slice(0, 200).map(c => {
                const isEditing = editingId === c.id;
                return (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">
                    {isEditing
                      ? <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} className="h-8 font-mono" />
                      : c.code}
                  </TableCell>
                  <TableCell>
                    {isEditing
                      ? <Input type="number" min={0} value={editValue || ''} onChange={(e) => setEditValue(Number(e.target.value))} className="h-8 w-28" />
                      : `₦${Number(c.value).toLocaleString()}`}
                  </TableCell>
                  <TableCell><Badge variant={c.status === 'available' ? 'default' : 'secondary'}>{c.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right space-x-1">
                    {c.status === 'available' && !isEditing && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => startEdit(c)}><Pencil className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="w-4 h-4" /></Button>
                      </>
                    )}
                    {isEditing && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => saveEdit(c.id)}><Check className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}><X className="w-4 h-4" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {selectedId && <CsvUploadDialog open={csvOpen} onOpenChange={setCsvOpen} categoryId={selectedId} onDone={refetch} />}
    </Card>
  );
}


function TemplateTab({ vendorId, vendorName, template, refetch, setTemplate }: any) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [bgMode, setBgMode] = useState<'color' | 'image'>(template?.background_image_url ? 'image' : 'color');
  const [saving, setSaving] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [vendorLogo, setVendorLogo] = useState<string | null>(null);

  useEffect(() => {
    if (!vendorId) return;
    supabase.from('vendors').select('logo_url').eq('id', vendorId).maybeSingle()
      .then(({ data }) => setVendorLogo((data as any)?.logo_url || null));
  }, [vendorId]);

  const uploadBg = async (file: File) => {
    if (!user) return;
    if (!file.type.startsWith('image/')) return toast({ title: 'Please pick an image', variant: 'destructive' });
    if (file.size > 5 * 1024 * 1024) return toast({ title: 'Image too large (max 5MB)', variant: 'destructive' });
    setUploadingBg(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${user.id}/voucher-bg-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('vendor-assets').upload(path, file, { contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from('vendor-assets').getPublicUrl(path);
      setTemplate({ ...template, background_image_url: data.publicUrl });
      toast({ title: 'Background uploaded' });
    } catch (e: any) {
      toast({ title: 'Upload failed', description: e.message, variant: 'destructive' });
    } finally {
      setUploadingBg(false);
    }
  };

  const save = async () => {
    if (!template) return;
    setSaving(true);
    const payload = {
      vendor_id: vendorId,
      // Storefront uses your business logo automatically — no separate upload needed.
      logo_url: null,
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
          <div className="rounded-lg border border-dashed p-3 flex items-center gap-3 bg-muted/40">
            {vendorLogo ? (
              <img src={vendorLogo} alt="Business logo" className="w-14 h-14 rounded-lg object-cover" />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground">No logo</div>
            )}
            <div className="text-xs text-muted-foreground">
              Your <span className="font-medium text-foreground">business logo</span> is used automatically on the storefront and voucher image.{' '}
              {!vendorLogo && <>Add one from <span className="font-medium">Store Settings</span>.</>}
            </div>
          </div>
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
            <div className="space-y-2">
              <Label>Background image</Label>
              {template?.background_image_url && (
                <div className="relative inline-block">
                  <img src={template.background_image_url} alt="" className="w-full max-w-xs h-32 object-cover rounded border" />
                  <button
                    type="button"
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow"
                    onClick={() => setTemplate({ ...template, background_image_url: null })}
                    aria-label="Remove background"
                  ><X className="w-3 h-3" /></button>
                </div>
              )}
              <label className="flex items-center gap-2 px-3 py-2 rounded-md border border-dashed cursor-pointer text-sm hover:bg-muted/50 w-fit">
                <Upload className="w-4 h-4" />
                {uploadingBg ? 'Uploading…' : (template?.background_image_url ? 'Replace image' : 'Upload background image')}
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBg(f); e.currentTarget.value = ''; }} />
              </label>
            </div>
          )}
          <Button onClick={save} disabled={saving} className="w-full">{saving ? 'Saving…' : 'Save template'}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Live preview</CardTitle></CardHeader>
        <CardContent className="flex justify-center">
          <VoucherPreview
            vendorName={vendorName}
            vendorLogoUrl={vendorLogo}
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
  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  useEffect(() => {
    if (!vendorId || categories.length === 0) { setPerCategory({}); return; }
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

  useEffect(() => {
    if (!vendorId) return;
    setLoadingOrders(true);
    (async () => {
      const { data } = await supabase
        .from('voucher_orders')
        .select('id, amount, status, purchased_at, guest_email, guest_phone, paystack_reference, category_id, code_id')
        .eq('vendor_id', vendorId)
        .order('purchased_at', { ascending: false })
        .limit(200);
      const rows = (data || []) as any[];
      const codeIds = rows.map(r => r.code_id).filter(Boolean);
      let codeMap: Record<string, string> = {};
      if (codeIds.length) {
        const { data: codes } = await supabase.from('voucher_codes').select('id, code').in('id', codeIds);
        for (const c of codes || []) codeMap[(c as any).id] = (c as any).code;
      }
      const catMap: Record<string, string> = {};
      categories.forEach(c => { catMap[c.id] = c.name; });
      setOrders(rows.map(r => ({ ...r, code: codeMap[r.code_id] || '—', categoryName: catMap[r.category_id] || '—' })));
      setLoadingOrders(false);
    })();
  }, [vendorId, categories]);

  const exportCsv = () => {
    const header = ['Purchased At', 'Category', 'Code', 'Amount', 'Email', 'Phone', 'Reference', 'Status'];
    const rows = orders.map(o => [
      new Date(o.purchased_at).toISOString(),
      o.categoryName,
      o.code,
      o.amount,
      o.guest_email || '',
      o.guest_phone || '',
      o.paystack_reference || '',
      o.status,
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `voucher-sales-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Buyer reconciliation ({orders.length})</CardTitle>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={orders.length === 0}>Export CSV</Button>
        </CardHeader>
        <CardContent>
          {loadingOrders ? (
            <p className="text-sm text-muted-foreground text-center py-6">Loading…</p>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No sales yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Code issued</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map(o => (
                    <TableRow key={o.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(o.purchased_at).toLocaleString()}</TableCell>
                      <TableCell>{o.categoryName}</TableCell>
                      <TableCell className="font-mono text-xs">{o.code}</TableCell>
                      <TableCell>₦{Number(o.amount).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{o.guest_email || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-xs">{o.guest_phone || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground">{o.paystack_reference || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
