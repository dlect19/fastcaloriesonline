import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { BottomNav } from '@/components/home/BottomNav';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ArrowLeft, Pill, Clock, Check, Bell, Play, History, Loader2, Baby, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow } from 'date-fns';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

interface DrugUsage {
  id: string;
  drug_name: string;
  total_doses: number;
  doses_taken: number;
  doses_remaining: number | null;
  completion_percentage: number | null;
  next_dose_at: string | null;
  last_taken_at: string | null;
  is_completed: boolean;
  started_at: string | null;
  prescription_order_id: string;
}

interface Reminder {
  id: string;
  drug_name: string;
  dosage: string | null;
  frequency: string;
  reminder_times: string[];
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
}

export default function DrugTracker() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [usageRecords, setUsageRecords] = useState<DrugUsage[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
    if (user) fetchData();
  }, [user, authLoading]);

  const fetchData = async () => {
    const [{ data: usage }, { data: rem }] = await Promise.all([
      supabase.from('drug_usage_tracking').select('*').eq('user_id', user!.id).order('created_at', { ascending: false }),
      supabase.from('drug_reminders').select('*').eq('user_id', user!.id).eq('is_active', true).order('created_at', { ascending: false }),
    ]);
    setUsageRecords(usage || []);
    setReminders(rem || []);
    setLoading(false);
  };

  const startTracking = async (record: DrugUsage) => {
    await supabase.from('drug_usage_tracking').update({
      started_at: new Date().toISOString(),
      next_dose_at: new Date().toISOString(),
    }).eq('id', record.id);

    toast({ title: '▶️ Tracking Started', description: `${record.drug_name} - you can now log doses` });
    fetchData();
  };

  const takeDose = async (record: DrugUsage) => {
    if (record.is_completed) return;
    const newDosesTaken = record.doses_taken + 1;
    const isComplete = newDosesTaken >= record.total_doses;
    const completionPct = Math.round((newDosesTaken / record.total_doses) * 100);

    await supabase.from('drug_usage_tracking').update({
      doses_taken: newDosesTaken,
      doses_remaining: record.total_doses - newDosesTaken,
      completion_percentage: completionPct,
      last_taken_at: new Date().toISOString(),
      is_completed: isComplete,
      next_dose_at: isComplete ? null : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    }).eq('id', record.id);

    if (isComplete) {
      // Deactivate reminders for this tracking
      await supabase.from('drug_reminders').update({ is_active: false })
        .eq('drug_usage_tracking_id', record.id);
    }

    toast({ title: isComplete ? '🎉 Course Completed!' : '✅ Dose Taken', description: `${record.drug_name} - ${newDosesTaken}/${record.total_doses} doses` });
    fetchData();
  };

  const notStarted = usageRecords.filter(u => !u.is_completed && !u.started_at);
  const activeUsage = usageRecords.filter(u => !u.is_completed && u.started_at);
  const completedUsage = usageRecords.filter(u => u.is_completed);

  if (authLoading || loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)}><ArrowLeft className="w-5 h-5" /></button>
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-8 h-8" />
            <div>
              <h1 className="font-bold text-foreground">Drug Tracker</h1>
              <p className="text-xs text-muted-foreground">Track your medication progress</p>
            </div>
          </div>
          <Button
            variant={showHistory ? 'default' : 'outline'}
            size="sm"
            className="gap-1"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="w-4 h-4" />
            {showHistory ? 'Active' : 'History'}
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {!showHistory ? (
          <>
            {/* Not Yet Started */}
            {notStarted.length > 0 && (
              <div>
                <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Play className="w-5 h-5 text-primary" /> Ready to Start ({notStarted.length})
                </h2>
                <div className="space-y-3">
                  {notStarted.map(record => (
                    <Card key={record.id} className="overflow-hidden border-primary/30">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-semibold text-foreground">{record.drug_name}</p>
                            <p className="text-xs text-muted-foreground">{record.total_doses} total doses</p>
                          </div>
                          <Badge variant="secondary" className="text-xs">Not Started</Badge>
                        </div>
                        <Button size="sm" className="w-full gap-1" onClick={() => startTracking(record)}>
                          <Play className="w-3 h-3" /> Start Taking This Medication
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Active Medications */}
            <div>
              <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <Pill className="w-5 h-5 text-primary" /> Active Medications ({activeUsage.length})
              </h2>
              {activeUsage.length === 0 && notStarted.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Pill className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>No active medications</p>
                    <p className="text-xs mt-1">Order medicines from a pharmacy to start tracking</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {activeUsage.map(record => (
                    <Card key={record.id} className="overflow-hidden">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <p className="font-semibold text-foreground">{record.drug_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {record.doses_taken}/{record.total_doses} doses taken
                            </p>
                            {record.started_at && (
                              <p className="text-xs text-muted-foreground">
                                Started {formatDistanceToNow(new Date(record.started_at), { addSuffix: true })}
                              </p>
                            )}
                          </div>
                          <Badge variant={record.completion_percentage && record.completion_percentage > 50 ? 'default' : 'secondary'}>
                            {Math.round(record.completion_percentage || 0)}%
                          </Badge>
                        </div>
                        <Progress value={record.completion_percentage || 0} className="h-2 mb-3" />
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {record.next_dose_at ? `Next: ${format(new Date(record.next_dose_at), 'h:mm a')}` : 'No schedule set'}
                          </div>
                          <Button size="sm" onClick={() => takeDose(record)} className="gap-1">
                            <Check className="w-3 h-3" /> Take Dose
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Reminders */}
            {reminders.length > 0 && (
              <div>
                <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Bell className="w-5 h-5 text-primary" /> Active Reminders ({reminders.length})
                </h2>
                <div className="space-y-2">
                  {reminders.map(rem => (
                    <Card key={rem.id}>
                      <CardContent className="p-3 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm text-foreground">{rem.drug_name}</p>
                          <p className="text-xs text-muted-foreground">{rem.dosage} • {rem.frequency.replace(/_/g, ' ')}</p>
                          <p className="text-xs text-muted-foreground">Times: {rem.reminder_times.join(', ')}</p>
                        </div>
                        <Badge variant="outline" className="text-xs">Active</Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* History View - All completed and current courses */
          <div>
            <h2 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <History className="w-5 h-5 text-primary" /> Drug Usage History ({usageRecords.length})
            </h2>
            {usageRecords.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No drug usage history yet</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {usageRecords.map(record => (
                  <Card key={record.id} className={record.is_completed ? 'opacity-80' : ''}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-semibold text-sm text-foreground">{record.drug_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {record.doses_taken}/{record.total_doses} doses
                          </p>
                        </div>
                        <Badge variant={record.is_completed ? 'outline' : 'default'} className={`text-xs ${record.is_completed ? 'text-calorie-low border-calorie-low' : ''}`}>
                          {record.is_completed ? '✅ Completed' : record.started_at ? `${Math.round(record.completion_percentage || 0)}% In Progress` : 'Not Started'}
                        </Badge>
                      </div>
                      <Progress value={record.completion_percentage || 0} className="h-1.5 mb-2" />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{record.started_at ? `Started: ${format(new Date(record.started_at), 'MMM d, yyyy')}` : 'Not started'}</span>
                        {record.last_taken_at && <span>Last dose: {format(new Date(record.last_taken_at), 'MMM d, h:mm a')}</span>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
