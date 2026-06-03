import { useState } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Plus, Pencil, Trash2, UtensilsCrossed } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  useCuisineCategories,
  type CuisineCategory,
} from '@/hooks/useCuisineCategories';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface FormState {
  id?: string;
  name: string;
  icon: string;
  parent_id: string | null;
  sort_order: number;
}

const EMPTY: FormState = { name: '', icon: '', parent_id: null, sort_order: 0 };

export default function AdminCuisineCategories() {
  const { grouped, parents, loading, refetch } = useCuisineCategories();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CuisineCategory | null>(null);

  const openCreate = (parentId?: string | null) => {
    setForm({ ...EMPTY, parent_id: parentId ?? null });
    setOpen(true);
  };

  const openEdit = (c: CuisineCategory) => {
    setForm({
      id: c.id,
      name: c.name,
      icon: c.icon || '',
      parent_id: c.parent_id,
      sort_order: c.sort_order ?? 0,
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      icon: form.icon.trim() || null,
      parent_id: form.parent_id || null,
      sort_order: Number(form.sort_order) || 0,
    };
    const { error } = form.id
      ? await supabase.from('cuisine_categories').update(payload).eq('id', form.id)
      : await supabase.from('cuisine_categories').insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: form.id ? 'Category updated' : 'Category added' });
    setOpen(false);
    refetch();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase
      .from('cuisine_categories')
      .delete()
      .eq('id', deleteTarget.id);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Deleted' });
      refetch();
    }
    setDeleteTarget(null);
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <UtensilsCrossed className="w-6 h-6" /> Cuisine Categories
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage the food categories customers browse by (Pizza, Soup, Rice, etc.). Vendors tag
              their menu items to these.
            </p>
          </div>
          <Button onClick={() => openCreate(null)}>
            <Plus className="w-4 h-4 mr-2" /> Add Category
          </Button>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : grouped.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground mb-4">No categories yet.</p>
            <Button onClick={() => openCreate(null)}>
              <Plus className="w-4 h-4 mr-2" /> Add First Category
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {grouped.map((parent) => (
              <Card key={parent.id} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{parent.icon || '🍽️'}</span>
                    <div>
                      <h3 className="font-semibold text-foreground">{parent.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        Sort {parent.sort_order ?? 0} · {parent.children.length} sub-categories
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openCreate(parent.id)}>
                      <Plus className="w-3 h-3 mr-1" /> Sub
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(parent)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(parent)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                {parent.children.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pl-2 border-l-2 border-border ml-3">
                    {parent.children.map((child) => (
                      <div
                        key={child.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-secondary/40 hover:bg-secondary"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg">{child.icon || '•'}</span>
                          <span className="text-sm font-medium truncate">{child.name}</span>
                          <span className="text-xs text-muted-foreground">
                            #{child.sort_order ?? 0}
                          </span>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(child)}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDeleteTarget(child)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? 'Edit Category' : 'New Category'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Jollof & Rice Dishes"
              />
            </div>
            <div>
              <Label>Icon (emoji)</Label>
              <Input
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                placeholder="🍚"
                maxLength={4}
              />
            </div>
            <div>
              <Label>Parent (optional)</Label>
              <Select
                value={form.parent_id ?? 'none'}
                onValueChange={(v) => setForm({ ...form, parent_id: v === 'none' ? null : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None (top-level) —</SelectItem>
                  {parents
                    .filter((p) => p.id !== form.id)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.icon || '🍽️'} {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Sort order</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Products tagged to this category will become uncategorized. Sub-categories will also
              be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
