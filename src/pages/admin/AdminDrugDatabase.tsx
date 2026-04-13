import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, Plus, Edit2, Trash2, Pill, FolderTree, ImagePlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface DrugCategory {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
}

interface Drug {
  id: string;
  name: string;
  generic_name: string | null;
  category_id: string | null;
  dosage_form: string;
  strength: string | null;
  description: string | null;
  requires_prescription: boolean;
  manufacturer: string | null;
  side_effects: string[] | null;
  contraindications: string[] | null;
  common_dosage_instructions: string | null;
  default_dosage_frequency: string | null;
  default_dosage_duration_days: number | null;
  default_quantity_per_dose: number | null;
  is_active: boolean;
  image_url: string | null;
}

const DOSAGE_FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'cream', 'ointment', 'gel', 'eye drops', 'ear drops', 'inhaler', 'injection', 'sachet', 'solution', 'suppository', 'patch'];
const FREQUENCY_OPTIONS = [
  { value: 'once_daily', label: 'Once Daily' },
  { value: 'twice_daily', label: 'Twice Daily' },
  { value: 'three_times_daily', label: 'Three Times Daily' },
  { value: 'four_times_daily', label: 'Four Times Daily' },
  { value: 'every_2_hours', label: 'Every 2 Hours' },
  { value: 'every_4_hours', label: 'Every 4 Hours' },
  { value: 'every_6_hours', label: 'Every 6 Hours' },
  { value: 'every_8_hours', label: 'Every 8 Hours' },
  { value: 'five_times_daily', label: 'Five Times Daily' },
  { value: 'as_needed', label: 'As Needed' },
];

export default function AdminDrugDatabase() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<DrugCategory[]>([]);
  const [drugs, setDrugs] = useState<Drug[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('drugs');

  // Drug dialog
  const [drugDialogOpen, setDrugDialogOpen] = useState(false);
  const [editingDrug, setEditingDrug] = useState<Drug | null>(null);
  const [drugForm, setDrugForm] = useState({
    name: '', generic_name: '', category_id: '', dosage_form: 'tablet', strength: '',
    description: '', requires_prescription: false, manufacturer: '',
    side_effects: '', contraindications: '', common_dosage_instructions: '',
    default_dosage_frequency: 'twice_daily', default_dosage_duration_days: '',
    default_quantity_per_dose: '1', is_active: true, image_url: '',
  });
  const [uploadingImage, setUploadingImage] = useState(false);

  // Category dialog
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<DrugCategory | null>(null);
  const [catForm, setCatForm] = useState({ name: '', description: '', icon: '', sort_order: '0' });

  useEffect(() => {
    checkAuthAndFetch();
  }, []);

  const checkAuthAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }
    const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    if (!roles?.some(r => r.role === 'admin')) { navigate('/admin/auth'); return; }
    await fetchData();
    setLoading(false);
  };

  const fetchData = async () => {
    const [{ data: cats }, { data: drugList }] = await Promise.all([
      supabase.from('drug_categories').select('*').order('sort_order'),
      supabase.from('drug_database').select('*').order('name'),
    ]);
    setCategories(cats || []);
    setDrugs(drugList || []);
  };

  // Drug CRUD
  const openDrugDialog = (drug?: Drug) => {
    if (drug) {
      setEditingDrug(drug);
      setDrugForm({
        name: drug.name, generic_name: drug.generic_name || '', category_id: drug.category_id || '',
        dosage_form: drug.dosage_form, strength: drug.strength || '', description: drug.description || '',
        requires_prescription: drug.requires_prescription, manufacturer: drug.manufacturer || '',
        side_effects: (drug.side_effects || []).join(', '), contraindications: (drug.contraindications || []).join(', '),
        common_dosage_instructions: drug.common_dosage_instructions || '',
        default_dosage_frequency: drug.default_dosage_frequency || 'twice_daily',
        default_dosage_duration_days: drug.default_dosage_duration_days?.toString() || '',
        default_quantity_per_dose: drug.default_quantity_per_dose?.toString() || '1',
        is_active: drug.is_active, image_url: drug.image_url || '',
      });
    } else {
      setEditingDrug(null);
      setDrugForm({
        name: '', generic_name: '', category_id: '', dosage_form: 'tablet', strength: '',
        description: '', requires_prescription: false, manufacturer: '',
        side_effects: '', contraindications: '', common_dosage_instructions: '',
        default_dosage_frequency: 'twice_daily', default_dosage_duration_days: '', default_quantity_per_dose: '1', is_active: true, image_url: '',
      });
    }
    setDrugDialogOpen(true);
  };

  const saveDrug = async () => {
    const data: any = {
      name: drugForm.name, generic_name: drugForm.generic_name || null,
      category_id: drugForm.category_id || null, dosage_form: drugForm.dosage_form,
      strength: drugForm.strength || null, description: drugForm.description || null,
      requires_prescription: drugForm.requires_prescription, manufacturer: drugForm.manufacturer || null,
      side_effects: drugForm.side_effects ? drugForm.side_effects.split(',').map(s => s.trim()).filter(Boolean) : null,
      contraindications: drugForm.contraindications ? drugForm.contraindications.split(',').map(s => s.trim()).filter(Boolean) : null,
      common_dosage_instructions: drugForm.common_dosage_instructions || null,
      default_dosage_frequency: drugForm.default_dosage_frequency,
      default_dosage_duration_days: drugForm.default_dosage_duration_days ? parseInt(drugForm.default_dosage_duration_days) : null,
      default_quantity_per_dose: parseInt(drugForm.default_quantity_per_dose) || 1,
      is_active: drugForm.is_active,
      image_url: drugForm.image_url || null,
    };

    if (editingDrug) {
      const { error } = await supabase.from('drug_database').update(data).eq('id', editingDrug.id);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Drug updated' });
    } else {
      const { error } = await supabase.from('drug_database').insert(data);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Drug added' });
    }
    setDrugDialogOpen(false);
    fetchData();
  };

  const handleDrugImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `drug-images/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('product-images').upload(path, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path);
      setDrugForm(f => ({ ...f, image_url: publicUrl }));
      toast({ title: 'Image uploaded' });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setUploadingImage(false);
    }
  };

  const deleteDrug = async (id: string) => {
    if (!confirm('Delete this drug from the database?')) return;
    await supabase.from('drug_database').delete().eq('id', id);
    toast({ title: 'Drug deleted' });
    fetchData();
  };

  // Category CRUD
  const openCatDialog = (cat?: DrugCategory) => {
    if (cat) {
      setEditingCat(cat);
      setCatForm({ name: cat.name, description: cat.description || '', icon: cat.icon || '', sort_order: cat.sort_order.toString() });
    } else {
      setEditingCat(null);
      setCatForm({ name: '', description: '', icon: '', sort_order: '0' });
    }
    setCatDialogOpen(true);
  };

  const saveCat = async () => {
    const data = {
      name: catForm.name, description: catForm.description || null,
      icon: catForm.icon || null, sort_order: parseInt(catForm.sort_order) || 0,
    };
    if (editingCat) {
      await supabase.from('drug_categories').update(data).eq('id', editingCat.id);
      toast({ title: 'Category updated' });
    } else {
      await supabase.from('drug_categories').insert(data);
      toast({ title: 'Category added' });
    }
    setCatDialogOpen(false);
    fetchData();
  };

  const deleteCat = async (id: string) => {
    if (!confirm('Delete this category?')) return;
    await supabase.from('drug_categories').delete().eq('id', id);
    toast({ title: 'Category deleted' });
    fetchData();
  };

  const filtered = drugs.filter(d => {
    const matchCat = selectedCategory === 'all' || d.category_id === selectedCategory;
    const matchSearch = !searchQuery || d.name.toLowerCase().includes(searchQuery.toLowerCase()) || d.generic_name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  const getCatName = (id: string | null) => categories.find(c => c.id === id)?.name || 'Uncategorized';
  const getCatIcon = (id: string | null) => categories.find(c => c.id === id)?.icon || '💊';

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return (
    <AdminLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground">Drug Database</h1>
        <p className="text-muted-foreground">Central drug catalog and categories for all pharmacies</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="drugs" className="gap-2"><Pill className="w-4 h-4" /> Drugs ({drugs.length})</TabsTrigger>
          <TabsTrigger value="categories" className="gap-2"><FolderTree className="w-4 h-4" /> Categories ({categories.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="drugs">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search drugs..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
            </div>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={() => openDrugDialog()} className="gap-2"><Plus className="w-4 h-4" /> Add Drug</Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-12">No drugs found</p>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map(drug => (
                    <div key={drug.id} className="p-4 flex items-start justify-between gap-4 hover:bg-secondary/30 transition-colors">
                      {(drug as any).image_url && (
                        <img src={(drug as any).image_url} alt={drug.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                      )}
                      {!(drug as any).image_url && (
                        <div className="w-12 h-12 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                          <Pill className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground">{drug.name}</span>
                          {drug.strength && <Badge variant="outline" className="text-xs">{drug.strength}</Badge>}
                          <Badge variant="secondary" className="text-xs">{drug.dosage_form}</Badge>
                          {drug.requires_prescription && <Badge variant="destructive" className="text-xs">Rx</Badge>}
                          {!drug.is_active && <Badge variant="outline" className="text-xs text-muted-foreground">Inactive</Badge>}
                        </div>
                        {drug.generic_name && <p className="text-sm text-muted-foreground mt-0.5">Generic: {drug.generic_name}</p>}
                        <p className="text-xs text-muted-foreground">{getCatIcon(drug.category_id)} {getCatName(drug.category_id)}</p>
                        {drug.common_dosage_instructions && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{drug.common_dosage_instructions}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => openDrugDialog(drug)}><Edit2 className="w-4 h-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteDrug(drug.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <div className="flex justify-end mb-4">
            <Button onClick={() => openCatDialog()} className="gap-2"><Plus className="w-4 h-4" /> Add Category</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map(cat => (
              <Card key={cat.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">{cat.icon} {cat.name}</p>
                    {cat.description && <p className="text-xs text-muted-foreground line-clamp-1">{cat.description}</p>}
                    <p className="text-xs text-muted-foreground">{drugs.filter(d => d.category_id === cat.id).length} drugs</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openCatDialog(cat)}><Edit2 className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteCat(cat.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Drug Dialog */}
      {drugDialogOpen && (
        <Dialog open onOpenChange={open => { if (!open) setDrugDialogOpen(false); }}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingDrug ? 'Edit Drug' : 'Add Drug to Database'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Drug Name *</Label>
                  <Input value={drugForm.name} onChange={e => setDrugForm({ ...drugForm, name: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Generic Name</Label>
                  <Input value={drugForm.generic_name} onChange={e => setDrugForm({ ...drugForm, generic_name: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Category</Label>
                  <Select value={drugForm.category_id || 'none'} onValueChange={v => setDrugForm({ ...drugForm, category_id: v === 'none' ? '' : v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Dosage Form</Label>
                  <Select value={drugForm.dosage_form} onValueChange={v => setDrugForm({ ...drugForm, dosage_form: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DOSAGE_FORMS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Strength</Label>
                  <Input value={drugForm.strength} onChange={e => setDrugForm({ ...drugForm, strength: e.target.value })} placeholder="e.g. 500mg" />
                </div>
                <div className="space-y-1">
                  <Label>Manufacturer</Label>
                  <Input value={drugForm.manufacturer} onChange={e => setDrugForm({ ...drugForm, manufacturer: e.target.value })} />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Description</Label>
                <Textarea value={drugForm.description} onChange={e => setDrugForm({ ...drugForm, description: e.target.value })} rows={2} />
              </div>

              <div className="space-y-1">
                <Label>Drug Image</Label>
                <div className="flex items-center gap-3">
                  {drugForm.image_url && (
                    <img src={drugForm.image_url} alt="Drug" className="w-16 h-16 rounded-lg object-cover border" />
                  )}
                  <label className="flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer hover:bg-secondary/50 transition-colors text-sm">
                    {uploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                    {uploadingImage ? 'Uploading...' : 'Upload Image'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleDrugImageUpload} disabled={uploadingImage} />
                  </label>
                  {drugForm.image_url && (
                    <Button variant="ghost" size="sm" onClick={() => setDrugForm(f => ({ ...f, image_url: '' }))}>Remove</Button>
                  )}
                </div>
              </div>

                <Textarea value={drugForm.common_dosage_instructions} onChange={e => setDrugForm({ ...drugForm, common_dosage_instructions: e.target.value })} rows={2} placeholder="e.g. Take 1 tablet twice daily after meals" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Frequency</Label>
                  <Select value={drugForm.default_dosage_frequency} onValueChange={v => setDrugForm({ ...drugForm, default_dosage_frequency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQUENCY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Duration (days)</Label>
                  <Input type="number" value={drugForm.default_dosage_duration_days} onChange={e => setDrugForm({ ...drugForm, default_dosage_duration_days: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Qty per dose</Label>
                  <Input type="number" value={drugForm.default_quantity_per_dose} onChange={e => setDrugForm({ ...drugForm, default_quantity_per_dose: e.target.value })} />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Side Effects (comma separated)</Label>
                <Input value={drugForm.side_effects} onChange={e => setDrugForm({ ...drugForm, side_effects: e.target.value })} placeholder="Nausea, Dizziness" />
              </div>

              <div className="space-y-1">
                <Label>Contraindications (comma separated)</Label>
                <Input value={drugForm.contraindications} onChange={e => setDrugForm({ ...drugForm, contraindications: e.target.value })} placeholder="Pregnancy, Liver disease" />
              </div>

              <div className="flex items-center justify-between">
                <Label>Requires Prescription (Rx)</Label>
                <Switch checked={drugForm.requires_prescription} onCheckedChange={v => setDrugForm({ ...drugForm, requires_prescription: v })} />
              </div>

              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={drugForm.is_active} onCheckedChange={v => setDrugForm({ ...drugForm, is_active: v })} />
              </div>

              <Button className="w-full" onClick={saveDrug} disabled={!drugForm.name}>
                {editingDrug ? 'Update Drug' : 'Add Drug'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Category Dialog */}
      {catDialogOpen && (
        <Dialog open onOpenChange={open => { if (!open) setCatDialogOpen(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCat ? 'Edit Category' : 'Add Category'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1"><Label>Name *</Label><Input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Description</Label><Input value={catForm.description} onChange={e => setCatForm({ ...catForm, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Icon (emoji)</Label><Input value={catForm.icon} onChange={e => setCatForm({ ...catForm, icon: e.target.value })} placeholder="💊" /></div>
                <div className="space-y-1"><Label>Sort Order</Label><Input type="number" value={catForm.sort_order} onChange={e => setCatForm({ ...catForm, sort_order: e.target.value })} /></div>
              </div>
              <Button className="w-full" onClick={saveCat} disabled={!catForm.name}>{editingCat ? 'Update' : 'Add Category'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AdminLayout>
  );
}
