import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;
type WorkingHours = Tables<'vendor_working_hours'>;

const DAYS = [
  { id: 0, name: 'Sunday' },
  { id: 1, name: 'Monday' },
  { id: 2, name: 'Tuesday' },
  { id: 3, name: 'Wednesday' },
  { id: 4, name: 'Thursday' },
  { id: 5, name: 'Friday' },
  { id: 6, name: 'Saturday' },
];

interface DaySchedule {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

export default function VendorHours() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schedule, setSchedule] = useState<DaySchedule[]>(
    DAYS.map((day) => ({
      day_of_week: day.id,
      open_time: '09:00',
      close_time: '21:00',
      is_closed: day.id === 0, // Sunday closed by default
    }))
  );

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/vendor/auth');
      return;
    }
    if (user) {
      fetchData();
    }
  }, [user, authLoading, navigate]);

  const fetchData = async () => {
    try {
      const { data: vendorData } = await supabase
        .from('vendors')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      setVendor(vendorData);

      if (vendorData) {
        const { data: hoursData } = await supabase
          .from('vendor_working_hours')
          .select('*')
          .eq('vendor_id', vendorData.id);

        if (hoursData && hoursData.length > 0) {
          setSchedule(
            DAYS.map((day) => {
              const existing = hoursData.find((h) => h.day_of_week === day.id);
              return existing
                ? {
                    day_of_week: existing.day_of_week,
                    open_time: existing.open_time,
                    close_time: existing.close_time,
                    is_closed: existing.is_closed ?? false,
                  }
                : {
                    day_of_week: day.id,
                    open_time: '09:00',
                    close_time: '21:00',
                    is_closed: false,
                  };
            })
          );
        }
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!vendor) return;
    setSaving(true);

    try {
      // Delete existing hours
      await supabase
        .from('vendor_working_hours')
        .delete()
        .eq('vendor_id', vendor.id);

      // Insert new hours
      const { error } = await supabase
        .from('vendor_working_hours')
        .insert(
          schedule.map((s) => ({
            vendor_id: vendor.id,
            day_of_week: s.day_of_week,
            open_time: s.open_time,
            close_time: s.close_time,
            is_closed: s.is_closed,
          }))
        );

      if (error) throw error;

      toast({ title: 'Working hours saved successfully' });
    } catch (error: any) {
      toast({
        title: 'Error saving hours',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const updateDay = (dayIndex: number, updates: Partial<DaySchedule>) => {
    setSchedule((prev) =>
      prev.map((day) =>
        day.day_of_week === dayIndex ? { ...day, ...updates } : day
      )
    );
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background">
        <VendorSidebar />
        <main className="lg:ml-64 pt-14 lg:pt-0">
          <div className="p-6 space-y-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-96 rounded-2xl" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <VendorSidebar vendorName={vendor?.name} />

      <main className="lg:ml-64 pt-14 lg:pt-0">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Working Hours</h1>
              <p className="text-muted-foreground">Set your business availability</p>
            </div>
            <Button onClick={handleSave} disabled={saving} className="gap-2 w-fit">
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>

          {/* Schedule Card */}
          <Card className="border-0 shadow-soft">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Weekly Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {DAYS.map((day) => {
                const daySchedule = schedule.find((s) => s.day_of_week === day.id)!;
                return (
                  <div
                    key={day.id}
                    className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-xl bg-muted/50"
                  >
                    <div className="flex items-center justify-between sm:w-32">
                      <span className="font-medium text-foreground">{day.name}</span>
                      <Switch
                        checked={!daySchedule.is_closed}
                        onCheckedChange={(open) =>
                          updateDay(day.id, { is_closed: !open })
                        }
                        className="sm:hidden"
                      />
                    </div>

                    <div className="hidden sm:block">
                      <Switch
                        checked={!daySchedule.is_closed}
                        onCheckedChange={(open) =>
                          updateDay(day.id, { is_closed: !open })
                        }
                      />
                    </div>

                    {daySchedule.is_closed ? (
                      <span className="text-muted-foreground text-sm">Closed</span>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <Input
                          type="time"
                          value={daySchedule.open_time}
                          onChange={(e) =>
                            updateDay(day.id, { open_time: e.target.value })
                          }
                          className="w-32"
                        />
                        <span className="text-muted-foreground">to</span>
                        <Input
                          type="time"
                          value={daySchedule.close_time}
                          onChange={(e) =>
                            updateDay(day.id, { close_time: e.target.value })
                          }
                          className="w-32"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
