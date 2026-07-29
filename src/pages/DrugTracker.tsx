import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { BottomNav } from '@/components/home/BottomNav';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft, Pill, Clock, Check, Bell, History, Loader2, Settings, Plus,
  ShieldCheck, SkipForward, AlarmClock, Store,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';
import { useMedicationReminders, Occurrence } from '@/hooks/useMedicationReminders';
import { MedicationScheduleDialog, ScheduleDraft } from '@/components/pharmacy/MedicationScheduleDialog';
import { MedicationSettingsDialog } from '@/components/pharmacy/MedicationSettingsDialog';
import { isNativeAlarmPlatform } from '@/lib/medicationAlarms';

type Tab = 'today' | 'schedules' | 'history';

export default function DrugTracker() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params] = useSearchParams();

  const {
    loading, drafts, active, paused, completed, doses, today, nextUp,
    settings, syncInfo, refresh, resync, activateSchedule, setScheduleStatus,
    createManualSchedule, actOnDose, saveSettings,
  } = useMedicationReminders();

  const [tab, setTab] = useState<Tab>('today');
  const [reviewing, setReviewing] = useState<ScheduleDraft | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skipTarget, setSkipTarget] = useState<Occurrence | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate('/auth');
  }, [user, authLoading, navigate]);

  // Deep link from a tapped notification → focus that medication.
  useEffect(() => {
    if (params.get('reminder')) setTab('today');
  }, [params]);

  const scheduleMap = useMemo(
    () => new Map([...active, ...paused, ...completed, ...drafts].map((s) => [s.id, s])),
    [active, paused, completed, drafts],
  );

  const act = async (occ: Occurrence, status: 'taken' | 'skipped' | 'snoozed', minutes?: number) => {
    const res = await actOnDose(occ, status, minutes);
    if ((res as any).error) {
      toast({ title: 'Could not save', description: (res as any).error, variant: 'destructive' });
      return;
    }
    const offline = (res as any).offline;
    toast({
      title: status === 'taken' ? 'Dose recorded' : status === 'skipped' ? 'Dose skipped' : 'Reminder snoozed',
      description: offline
        ? 'Saved on your device — it will sync when you are back online.'
        : status === 'snoozed'
          ? `We will remind you again in ${minutes ?? settings.snooze_minutes} minutes.`
          : undefined,
    });
  };

  const statusBadge = (s: Occurrence['status']) => {
    if (s === 'taken') return <Badge className="text-xs gap-1"><Check className="w-3 h-3" /> Taken</Badge>;
    if (s === 'skipped') return <Badge variant="outline" className="text-xs">Skipped</Badge>;
    if (s === 'snoozed') return <Badge variant="secondary" className="text-xs">Snoozed</Badge>;
    if (s === 'due') return <Badge variant="destructive" className="text-xs">Due now</Badge>;
    return <Badge variant="secondary" className="text-xs">Upcoming</Badge>;
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} aria-label="Go back"><ArrowLeft className="w-5 h-5" /></button>
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-8 h-8" />
            <div>
              <h1 className="font-bold text-foreground">Medications</h1>
              <p className="text-xs text-muted-foreground">Reminders, doses & history</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Reminder settings">
            <Settings className="w-5 h-5" />
          </Button>
        </div>
        <div className="flex gap-1 px-4 pb-2">
          {(['today', 'schedules', 'history'] as Tab[]).map((t) => (
            <Button key={t} size="sm" variant={tab === t ? 'default' : 'ghost'} className="capitalize" onClick={() => setTab(t)}>
              {t}
            </Button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Draft schedules awaiting review */}
        {drafts.length > 0 && (
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="p-4 space-y-3">
              <div>
                <p className="font-semibold text-foreground">Your medication reminders are ready</p>
                <p className="text-xs text-muted-foreground">
                  We prepared {drafts.length} {drafts.length === 1 ? 'schedule' : 'schedules'} from the medication
                  instructions on your pharmacy order. Please review before activating.
                </p>
              </div>
              {drafts.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg bg-background p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {d.drug_name}{d.strength ? ` ${d.strength}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {(d as any).frequency?.replace(/_/g, ' ') || 'As instructed'}
                      {d.reminder_times.length === 0 ? ' • choose your times' : ` • ${d.reminder_times.join(', ')}`}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" onClick={() => setReviewing(d as any)}>Review</Button>
                    <Button size="sm" variant="ghost" onClick={() => setScheduleStatus(d.id, 'paused')}>Not now</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {isNativeAlarmPlatform() && syncInfo?.reason === 'permission_denied' && (
          <Card className="border-destructive/40">
            <CardContent className="p-4 text-sm">
              <p className="font-medium text-foreground">Notifications are blocked</p>
              <p className="text-xs text-muted-foreground">
                FastCalories cannot show medication reminders until notifications are allowed in your phone settings.
              </p>
              <Button size="sm" className="mt-2" onClick={() => resync()}>Try again</Button>
            </CardContent>
          </Card>
        )}

        {!isNativeAlarmPlatform() && active.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Install the FastCalories app on your phone to receive reminders while the app is closed.
          </p>
        )}

        {tab === 'today' && (
          <>
            {nextUp && (
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <AlarmClock className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Next dose at {format(nextUp.at, 'h:mm a')}</p>
                    <p className="text-xs text-muted-foreground">{nextUp.schedule.drug_name}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div>
              <h2 className="font-semibold mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" /> Today ({today.length})
              </h2>
              {today.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    <Pill className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p>No doses scheduled today</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {today.map((occ) => (
                    <Card key={occ.slotIso + occ.schedule.id}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">
                              {occ.schedule.drug_name}
                              {(occ.schedule as any).strength ? ` ${(occ.schedule as any).strength}` : ''}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {format(occ.at, 'h:mm a')}
                              {occ.schedule.dosage ? ` • ${occ.schedule.dosage}` : ''}
                            </p>
                            {(occ.schedule as any).instructions && (
                              <p className="text-xs text-muted-foreground">{(occ.schedule as any).instructions}</p>
                            )}
                          </div>
                          {statusBadge(occ.status)}
                        </div>

                        {(occ.status === 'due' || occ.status === 'upcoming' || occ.status === 'snoozed') && (
                          <div className="flex gap-2 mt-3">
                            <Button size="sm" className="gap-1 flex-1" onClick={() => act(occ, 'taken')}>
                              <Check className="w-3 h-3" /> Taken
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" className="gap-1">
                                  <AlarmClock className="w-3 h-3" /> Later
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {[10, 30, 60].map((m) => (
                                  <DropdownMenuItem key={m} onClick={() => act(occ, 'snoozed', m)}>
                                    In {m === 60 ? '1 hour' : `${m} minutes`}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button size="sm" variant="ghost" className="gap-1" onClick={() => setSkipTarget(occ)}>
                              <SkipForward className="w-3 h-3" /> Skip
                            </Button>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'schedules' && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" /> Active schedules ({active.length})
              </h2>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => setManualOpen(true)}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>

            {active.length === 0 && paused.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No medication schedules yet</p>
                  <p className="text-xs mt-1">Order from a FastCalories pharmacy, or add one manually.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {[...active, ...paused].map((s) => (
                  <Card key={s.id}>
                    <CardContent className="p-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">
                          {s.drug_name}{(s as any).strength ? ` ${(s as any).strength}` : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.dosage || '—'} • {s.reminder_times.join(', ') || 'no times set'}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-[10px] gap-1">
                            {(s as any).source === 'manual' ? (
                              <>Manual entry</>
                            ) : (
                              <><Store className="w-3 h-3" /> Pharmacy order</>
                            )}
                          </Badge>
                          {(s as any).verification_status === 'verified' && (
                            <Badge className="text-[10px] gap-1"><ShieldCheck className="w-3 h-3" /> Verified</Badge>
                          )}
                          <Badge variant={s.status === 'active' ? 'default' : 'secondary'} className="text-[10px] capitalize">
                            {s.status}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setReviewing(s as any)}>Edit times</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setScheduleStatus(s.id, s.status === 'active' ? 'paused' : 'active')}
                        >
                          {s.status === 'active' ? 'Pause' : 'Resume'}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'history' && (
          <div>
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <History className="w-5 h-5 text-primary" /> Dose history ({doses.length})
            </h2>
            {doses.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No dose history yet</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {doses.map((d) => (
                  <Card key={d.id}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{scheduleMap.get(d.reminder_id)?.drug_name || 'Medication'}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(d.scheduled_for), 'd MMM, h:mm a')}
                        </p>
                      </div>
                      <Badge variant={d.status === 'taken' ? 'default' : 'outline'} className="text-xs capitalize">
                        {d.status}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {completed.length > 0 && (
              <div className="mt-6">
                <h3 className="font-semibold mb-2 text-sm">Completed courses ({completed.length})</h3>
                <div className="space-y-2">
                  {completed.map((s) => (
                    <Card key={s.id}>
                      <CardContent className="p-3 text-sm flex items-center justify-between">
                        <span>{s.drug_name}</span>
                        <Badge variant="secondary" className="text-xs">Completed</Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <MedicationScheduleDialog
        open={!!reviewing}
        onOpenChange={(v) => !v && setReviewing(null)}
        mode="review"
        draft={reviewing}
        onConfirm={async (times, patch) => {
          if (!reviewing?.id) return;
          const res = await activateSchedule(reviewing.id, times, patch);
          toast(
            res.error
              ? { title: 'Could not activate', description: res.error, variant: 'destructive' }
              : { title: 'Reminders activated', description: 'Your device will now alert you at these times.' },
          );
          setReviewing(null);
        }}
      />

      <MedicationScheduleDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        mode="manual"
        onConfirm={async (times, patch) => {
          const res = await createManualSchedule({ ...patch, reminder_times: times });
          toast(
            res.error
              ? { title: 'Could not save', description: res.error, variant: 'destructive' }
              : { title: 'Reminder created' },
          );
        }}
      />

      <MedicationSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onSave={saveSettings}
        onResync={resync}
      />

      <AlertDialog open={!!skipTarget} onOpenChange={(v) => !v && setSkipTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip this dose?</AlertDialogTitle>
            <AlertDialogDescription>
              This records the dose as skipped. Your future reminders stay active and your prescribed instructions are
              unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (skipTarget) await act(skipTarget, 'skipped');
                setSkipTarget(null);
              }}
            >
              Skip dose
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </div>
  );
}
