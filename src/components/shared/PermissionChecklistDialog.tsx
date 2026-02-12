import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Shield } from 'lucide-react';

interface PermissionChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allPermissions: { key: string; label: string; description: string }[];
  roleDefaults: string[];
  currentPermissions: string[];
  onSave: (permissions: string[]) => void;
  roleName: string;
}

export function PermissionChecklistDialog({
  open,
  onOpenChange,
  allPermissions,
  roleDefaults,
  currentPermissions,
  onSave,
  roleName,
}: PermissionChecklistDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [useCustom, setUseCustom] = useState(false);

  useEffect(() => {
    if (open) {
      const hasCustom = currentPermissions.length > 0;
      setUseCustom(hasCustom);
      setSelected(new Set(hasCustom ? currentPermissions : roleDefaults));
    }
  }, [open, currentPermissions, roleDefaults]);

  const handleToggle = (key: string) => {
    setUseCustom(true);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleResetToDefaults = () => {
    setUseCustom(false);
    setSelected(new Set(roleDefaults));
  };

  const handleSave = () => {
    // If custom permissions match role defaults exactly, save empty array (use defaults)
    const selectedArr = Array.from(selected);
    const matchesDefaults = selectedArr.length === roleDefaults.length && 
      selectedArr.every(p => roleDefaults.includes(p));
    
    onSave(useCustom && !matchesDefaults ? selectedArr : []);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Edit Permissions
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Role: <Badge variant="secondary">{roleName}</Badge>
            </p>
            {useCustom && (
              <Button variant="ghost" size="sm" onClick={handleResetToDefaults}>
                Reset to defaults
              </Button>
            )}
          </div>

          {useCustom && (
            <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 rounded-md">
              Custom permissions override role defaults
            </p>
          )}

          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {allPermissions.map((perm) => (
              <div key={perm.key} className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50">
                <Checkbox
                  id={perm.key}
                  checked={selected.has(perm.key)}
                  onCheckedChange={() => handleToggle(perm.key)}
                />
                <div className="flex-1">
                  <Label htmlFor={perm.key} className="text-sm font-medium cursor-pointer">
                    {perm.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{perm.description}</p>
                </div>
                {roleDefaults.includes(perm.key) && !useCustom && (
                  <Badge variant="outline" className="text-xs shrink-0">Default</Badge>
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save Permissions</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
