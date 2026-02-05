 import { useState } from 'react';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Label } from '@/components/ui/label';
 import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
   DialogFooter,
 } from '@/components/ui/dialog';
 import { MapPin, Loader2 } from 'lucide-react';
 import { supabase } from '@/integrations/supabase/client';
 import { useToast } from '@/hooks/use-toast';
 
 interface VendorCoordinateEditorProps {
   vendor: {
     id: string;
     name: string;
     latitude?: number | null;
     longitude?: number | null;
   };
   onUpdate: () => void;
 }
 
 export function VendorCoordinateEditor({ vendor, onUpdate }: VendorCoordinateEditorProps) {
   const { toast } = useToast();
   const [open, setOpen] = useState(false);
   const [loading, setLoading] = useState(false);
   const [latitude, setLatitude] = useState(vendor.latitude?.toString() || '');
   const [longitude, setLongitude] = useState(vendor.longitude?.toString() || '');
 
   const handleSave = async () => {
     const lat = parseFloat(latitude);
     const lon = parseFloat(longitude);
 
     if (isNaN(lat) || isNaN(lon)) {
       toast({ title: 'Invalid coordinates', description: 'Please enter valid numbers', variant: 'destructive' });
       return;
     }
 
     if (lat < -90 || lat > 90) {
       toast({ title: 'Invalid latitude', description: 'Latitude must be between -90 and 90', variant: 'destructive' });
       return;
     }
 
     if (lon < -180 || lon > 180) {
       toast({ title: 'Invalid longitude', description: 'Longitude must be between -180 and 180', variant: 'destructive' });
       return;
     }
 
     setLoading(true);
     try {
       const { error } = await supabase
         .from('vendors')
         .update({ latitude: lat, longitude: lon })
         .eq('id', vendor.id);
 
       if (error) throw error;
 
       toast({ title: 'Coordinates updated', description: `${vendor.name} location has been updated` });
       setOpen(false);
       onUpdate();
     } catch (error) {
       console.error('Error updating coordinates:', error);
       toast({ title: 'Failed to update coordinates', variant: 'destructive' });
     } finally {
       setLoading(false);
     }
   };
 
   const handleOpenChange = (isOpen: boolean) => {
     setOpen(isOpen);
     if (isOpen) {
       setLatitude(vendor.latitude?.toString() || '');
       setLongitude(vendor.longitude?.toString() || '');
     }
   };
 
   return (
     <>
       <Button
         variant="outline"
         size="sm"
         onClick={() => setOpen(true)}
         className="gap-1"
       >
         <MapPin className="w-3 h-3" />
         GPS
       </Button>
 
       <Dialog open={open} onOpenChange={handleOpenChange}>
         <DialogContent className="sm:max-w-md">
           <DialogHeader>
             <DialogTitle>Edit Coordinates: {vendor.name}</DialogTitle>
           </DialogHeader>
 
           <div className="space-y-4 py-4">
             <div className="space-y-2">
               <Label htmlFor="latitude">Latitude</Label>
               <Input
                 id="latitude"
                 type="number"
                 step="any"
                 placeholder="e.g. 6.5244"
                 value={latitude}
                 onChange={(e) => setLatitude(e.target.value)}
               />
               <p className="text-xs text-muted-foreground">Range: -90 to 90</p>
             </div>
 
             <div className="space-y-2">
               <Label htmlFor="longitude">Longitude</Label>
               <Input
                 id="longitude"
                 type="number"
                 step="any"
                 placeholder="e.g. 3.3792"
                 value={longitude}
                 onChange={(e) => setLongitude(e.target.value)}
               />
               <p className="text-xs text-muted-foreground">Range: -180 to 180</p>
             </div>
 
             {vendor.latitude && vendor.longitude && (
               <div className="p-3 bg-muted rounded-lg text-sm">
                 <p className="font-medium">Current coordinates:</p>
                 <p className="text-muted-foreground">
                   {vendor.latitude}, {vendor.longitude}
                 </p>
               </div>
             )}
 
             {(!vendor.latitude || !vendor.longitude) && (
               <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm">
                 <p className="text-destructive">
                   ⚠️ This vendor has no coordinates set. They won't appear in nearby searches.
                 </p>
               </div>
             )}
           </div>
 
           <DialogFooter>
             <Button variant="outline" onClick={() => setOpen(false)}>
               Cancel
             </Button>
             <Button onClick={handleSave} disabled={loading}>
               {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
               Save Coordinates
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>
     </>
   );
 }