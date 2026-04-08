import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { CalendarIcon, Flame, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, eachDayOfInterval, eachMonthOfInterval, eachHourOfInterval, subDays } from 'date-fns';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';

type TimePeriod = 'today' | 'week' | 'month' | 'year' | 'custom';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
}

interface CalorieLog {
  id: string;
  calories: number;
  carbs_grams: number | null;
  protein_grams: number | null;
  fats_grams: number | null;
  meal_type: string | null;
  log_date: string;
  created_at: string;
  source?: string;
  food_items?: string[];
  confidence?: string;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))', 'hsl(142, 76%, 36%)', 'hsl(45, 93%, 47%)'];

export function AdminCustomerNutritionDetail({ open, onOpenChange, userId, userName }: Props) {
  const [period, setPeriod] = useState<TimePeriod>('month');
  const [logs, setLogs] = useState<CalorieLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [customFrom, setCustomFrom] = useState<Date | undefined>(subDays(new Date(), 7));
  const [customTo, setCustomTo] = useState<Date | undefined>(new Date());

  useEffect(() => {
    if (open && userId) fetchLogs();
  }, [open, userId, period, customFrom, customTo]);

  const getDateRange = () => {
    const now = new Date();
    switch (period) {
      case 'today': return { start: startOfDay(now), end: endOfDay(now) };
      case 'week': return { start: startOfWeek(now), end: endOfWeek(now) };
      case 'month': return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'year': return { start: startOfYear(now), end: endOfYear(now) };
      case 'custom': return { start: startOfDay(customFrom || subDays(now, 7)), end: endOfDay(customTo || now) };
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    const { start, end } = getDateRange();
    const { data } = await supabase
      .from('calorie_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('log_date', format(start, 'yyyy-MM-dd'))
      .lte('log_date', format(end, 'yyyy-MM-dd'))
      .order('created_at', { ascending: false });
    setLogs(data || []);
    setLoading(false);
  };

  const stats = useMemo(() => {
    const totalCalories = logs.reduce((s, l) => s + (l.calories || 0), 0);
    const totalCarbs = logs.reduce((s, l) => s + (l.carbs_grams || 0), 0);
    const totalProtein = logs.reduce((s, l) => s + (l.protein_grams || 0), 0);
    const totalFats = logs.reduce((s, l) => s + (l.fats_grams || 0), 0);
    const uniqueDays = new Set(logs.map(l => l.log_date)).size;
    const avgDaily = uniqueDays > 0 ? Math.round(totalCalories / uniqueDays) : 0;
    return { totalCalories, totalCarbs, totalProtein, totalFats, avgDaily };
  }, [logs]);

  const foodClassData = useMemo(() => [
    { name: 'Carbs', value: Math.round(stats.totalCarbs) },
    { name: 'Protein', value: Math.round(stats.totalProtein) },
    { name: 'Fats', value: Math.round(stats.totalFats) },
  ].filter(d => d.value > 0), [stats]);

  const mealTypeData = useMemo(() => {
    const map: Record<string, number> = {};
    logs.forEach(l => { const t = l.meal_type || 'other'; map[t] = (map[t] || 0) + (l.calories || 0); });
    return Object.entries(map).map(([n, v]) => ({ name: n.charAt(0).toUpperCase() + n.slice(1), value: v }));
  }, [logs]);

  const trendData = useMemo(() => {
    const { start, end } = getDateRange();
    let intervals: Date[];
    let formatStr: string;
    if (period === 'today') { intervals = eachHourOfInterval({ start, end }); formatStr = 'HH:00'; }
    else if (period === 'year') { intervals = eachMonthOfInterval({ start, end }); formatStr = 'MMM'; }
    else { intervals = eachDayOfInterval({ start, end }); formatStr = period === 'week' ? 'EEE' : 'dd'; }

    return intervals.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      let dayLogs: CalorieLog[];
      if (period === 'today') {
        const h = format(date, 'HH');
        dayLogs = logs.filter(l => format(new Date(l.created_at), 'yyyy-MM-dd') === dateStr && format(new Date(l.created_at), 'HH') === h);
      } else if (period === 'year') {
        const m = format(date, 'yyyy-MM');
        dayLogs = logs.filter(l => l.log_date.startsWith(m));
      } else {
        dayLogs = logs.filter(l => l.log_date === dateStr);
      }
      return {
        date: format(date, formatStr),
        calories: dayLogs.reduce((s, l) => s + (l.calories || 0), 0),
        carbs: dayLogs.reduce((s, l) => s + (l.carbs_grams || 0), 0),
        protein: dayLogs.reduce((s, l) => s + (l.protein_grams || 0), 0),
        fats: dayLogs.reduce((s, l) => s + (l.fats_grams || 0), 0),
      };
    });
  }, [logs, period]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-primary" />
            {userName}'s Nutrition Report
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={period} onValueChange={v => setPeriod(v as TimePeriod)}>
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="today" className="text-xs">Today</TabsTrigger>
              <TabsTrigger value="week" className="text-xs">Week</TabsTrigger>
              <TabsTrigger value="month" className="text-xs">Month</TabsTrigger>
              <TabsTrigger value="year" className="text-xs">Year</TabsTrigger>
              <TabsTrigger value="custom" className="text-xs">Custom</TabsTrigger>
            </TabsList>
          </Tabs>

          {period === 'custom' && (
            <div className="flex items-center gap-2 flex-wrap">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs">
                    <CalendarIcon className="w-3.5 h-3.5 mr-1" />
                    {customFrom ? format(customFrom, 'PPP') : 'From'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground text-sm">to</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="text-xs">
                    <CalendarIcon className="w-3.5 h-3.5 mr-1" />
                    {customTo ? format(customTo, 'PPP') : 'To'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customTo} onSelect={setCustomTo} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Stats Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Card><CardContent className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground">Total Calories</p>
              <p className="text-lg font-bold text-foreground">{stats.totalCalories.toLocaleString()}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground">Avg/Day</p>
              <p className="text-lg font-bold text-foreground">{stats.avgDaily.toLocaleString()}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground">Carbs</p>
              <p className="text-lg font-bold text-foreground">{Math.round(stats.totalCarbs)}g</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground">Protein</p>
              <p className="text-lg font-bold text-foreground">{Math.round(stats.totalProtein)}g</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground">Fats</p>
              <p className="text-lg font-bold text-foreground">{Math.round(stats.totalFats)}g</p>
            </CardContent></Card>
          </div>

          {/* Calorie Trend */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Calorie Trend</CardTitle></CardHeader>
            <CardContent>
              {loading ? <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Loading...</div> :
                trendData.some(d => d.calories > 0) ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                      <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }} />
                      <Bar dataKey="calories" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">No data</div>}
            </CardContent>
          </Card>

          {/* Pie Charts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Food Class</CardTitle></CardHeader>
              <CardContent>
                {foodClassData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={foodClassData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                        {foodClassData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${v}g`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">No data</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">By Meal Type</CardTitle></CardHeader>
              <CardContent>
                {mealTypeData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={mealTypeData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                        {mealTypeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `${v} kcal`} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">No data</div>}
              </CardContent>
            </Card>
          </div>

          {/* Meal Log */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Meal Log ({logs.length})</CardTitle></CardHeader>
            <CardContent>
              {logs.length === 0 ? (
                <p className="text-center py-4 text-muted-foreground text-sm">No meals logged</p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {logs.slice(0, 50).map(log => (
                    <div key={log.id} className="flex items-center justify-between p-2 bg-secondary/30 rounded-lg text-sm">
                      <div>
                        <span className="capitalize font-medium text-foreground">{log.source === 'camera' ? '📸' : '🛵'} {log.meal_type || 'Meal'}</span>
                        <span className="text-muted-foreground text-xs ml-2">{format(new Date(log.created_at), 'MMM dd, HH:mm')}</span>
                        {log.source === 'camera' && (
                          <span className="ml-1 text-xs text-primary font-medium">Camera</span>
                        )}
                        {log.food_items && log.food_items.length > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">{log.food_items.join(', ')}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-semibold text-foreground">{log.calories} kcal</span>
                        <p className="text-[10px] text-muted-foreground">C:{log.carbs_grams || 0}g P:{log.protein_grams || 0}g F:{log.fats_grams || 0}g</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
