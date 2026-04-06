import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ArrowLeft, Flame, TrendingUp, Apple, CalendarIcon, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, eachDayOfInterval, eachMonthOfInterval, eachHourOfInterval, subDays } from 'date-fns';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';

type TimePeriod = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';

interface CalorieLog {
  id: string;
  calories: number;
  carbs_grams: number | null;
  protein_grams: number | null;
  fats_grams: number | null;
  meal_type: string | null;
  log_date: string;
  created_at: string;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))', 'hsl(142, 76%, 36%)', 'hsl(45, 93%, 47%)'];

export default function NutritionReport() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<TimePeriod>('daily');
  const [logs, setLogs] = useState<CalorieLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [customFrom, setCustomFrom] = useState<Date | undefined>(subDays(new Date(), 7));
  const [customTo, setCustomTo] = useState<Date | undefined>(new Date());

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    fetchLogs();
  }, [user, period, customFrom, customTo]);

  const getDateRange = () => {
    const now = new Date();
    switch (period) {
      case 'daily':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'weekly':
        return { start: startOfWeek(now), end: endOfWeek(now) };
      case 'monthly':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'yearly':
        return { start: startOfYear(now), end: endOfYear(now) };
      case 'custom':
        return { start: startOfDay(customFrom || subDays(now, 7)), end: endOfDay(customTo || now) };
    }
  };

  const fetchLogs = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { start, end } = getDateRange();
      const { data } = await supabase
        .from('calorie_logs')
        .select('*')
        .eq('user_id', user.id)
        .gte('log_date', format(start, 'yyyy-MM-dd'))
        .lte('log_date', format(end, 'yyyy-MM-dd'))
        .order('created_at', { ascending: false });
      setLogs(data || []);
    } catch (e) {
      console.error('Error fetching logs:', e);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const totalCalories = logs.reduce((s, l) => s + (l.calories || 0), 0);
    const totalCarbs = logs.reduce((s, l) => s + (l.carbs_grams || 0), 0);
    const totalProtein = logs.reduce((s, l) => s + (l.protein_grams || 0), 0);
    const totalFats = logs.reduce((s, l) => s + (l.fats_grams || 0), 0);
    const uniqueDays = new Set(logs.map(l => l.log_date)).size;
    const avgDaily = uniqueDays > 0 ? Math.round(totalCalories / uniqueDays) : 0;
    return { totalCalories, totalCarbs, totalProtein, totalFats, avgDaily, uniqueDays };
  }, [logs]);

  const foodClassData = useMemo(() => {
    return [
      { name: 'Carbohydrates', value: Math.round(stats.totalCarbs) },
      { name: 'Protein', value: Math.round(stats.totalProtein) },
      { name: 'Fats', value: Math.round(stats.totalFats) },
    ].filter(d => d.value > 0);
  }, [stats]);

  const mealTypeData = useMemo(() => {
    const map: Record<string, number> = {};
    logs.forEach(l => {
      const type = l.meal_type || 'other';
      map[type] = (map[type] || 0) + (l.calories || 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));
  }, [logs]);

  const trendData = useMemo(() => {
    const { start, end } = getDateRange();
    let intervals: Date[];
    let formatStr: string;

    if (period === 'daily') {
      intervals = eachHourOfInterval({ start, end });
      formatStr = 'HH:00';
    } else if (period === 'yearly') {
      intervals = eachMonthOfInterval({ start, end });
      formatStr = 'MMM';
    } else {
      intervals = eachDayOfInterval({ start, end });
      formatStr = period === 'weekly' ? 'EEE' : 'dd MMM';
    }

    return intervals.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      let dayLogs: CalorieLog[];
      if (period === 'daily') {
        const hourStr = format(date, 'HH');
        dayLogs = logs.filter(l => {
          const logDate = new Date(l.created_at);
          return format(logDate, 'yyyy-MM-dd') === dateStr && format(logDate, 'HH') === hourStr;
        });
      } else if (period === 'yearly') {
        const monthStr = format(date, 'yyyy-MM');
        dayLogs = logs.filter(l => l.log_date.startsWith(monthStr));
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

  const macroTrendData = useMemo(() => trendData, [trendData]);

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Nutrition Report</h1>
            <p className="text-xs text-muted-foreground">Track your calorie & food class intake</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-5 max-w-4xl mx-auto">
        {/* Period Tabs */}
        <Tabs value={period} onValueChange={(v) => setPeriod(v as TimePeriod)}>
          <TabsList className="w-full grid grid-cols-5">
            <TabsTrigger value="daily" className="text-xs">Daily</TabsTrigger>
            <TabsTrigger value="weekly" className="text-xs">Weekly</TabsTrigger>
            <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
            <TabsTrigger value="yearly" className="text-xs">Yearly</TabsTrigger>
            <TabsTrigger value="custom" className="text-xs">Custom</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Custom Date Range Picker */}
        {period === 'custom' && (
          <div className="flex items-center gap-2 flex-wrap">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("text-xs", !customFrom && "text-muted-foreground")}>
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
                <Button variant="outline" size="sm" className={cn("text-xs", !customTo && "text-muted-foreground")}>
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

        {/* Summary Stats */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <Flame className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Total Calories</p>
                  <p className="text-lg font-bold text-foreground">{stats.totalCalories.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-primary/10 rounded-lg">
                  <TrendingUp className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Avg Daily</p>
                  <p className="text-lg font-bold text-foreground">{stats.avgDaily.toLocaleString()} kcal</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Macro Summary */}
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground">Carbs</p>
              <p className="text-lg font-bold text-foreground">{Math.round(stats.totalCarbs)}g</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground">Protein</p>
              <p className="text-lg font-bold text-foreground">{Math.round(stats.totalProtein)}g</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[11px] text-muted-foreground">Fats</p>
              <p className="text-lg font-bold text-foreground">{Math.round(stats.totalFats)}g</p>
            </CardContent>
          </Card>
        </div>

        {/* Calorie Trend Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Calorie Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
            ) : trendData.some(d => d.calories > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                {period === 'daily' || period === 'weekly' ? (
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                    <Bar dataKey="calories" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Calories" />
                  </BarChart>
                ) : (
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
                    <Line type="monotone" dataKey="calories" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="Calories" />
                  </LineChart>
                )}
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">No data for this period</div>
            )}
          </CardContent>
        </Card>

        {/* Macro Trend (Stacked) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Macronutrient Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
            ) : macroTrendData.some(d => d.carbs > 0 || d.protein > 0 || d.fats > 0) ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={macroTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} formatter={(value: number) => `${value}g`} />
                  <Legend />
                  <Bar dataKey="carbs" stackId="a" fill="hsl(var(--primary))" name="Carbs (g)" />
                  <Bar dataKey="protein" stackId="a" fill="hsl(var(--destructive))" name="Protein (g)" />
                  <Bar dataKey="fats" stackId="a" fill="hsl(45, 93%, 47%)" name="Fats (g)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">No data for this period</div>
            )}
          </CardContent>
        </Card>

        {/* Food Class Distribution Pie */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Food Class Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {foodClassData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={foodClassData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                      {foodClassData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => `${value}g`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </CardContent>
          </Card>

          {/* Meal Type Breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Calories by Meal Type</CardTitle>
            </CardHeader>
            <CardContent>
              {mealTypeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={mealTypeData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
                      {mealTypeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(value: number) => `${value} kcal`} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Meal Log List */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Meal Log ({logs.length} entries)</CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-center py-6 text-muted-foreground text-sm">No meals logged for this period</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {logs.map(log => (
                  <div key={log.id} className="flex items-center justify-between p-3 bg-secondary/30 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">
                        {log.meal_type === 'breakfast' ? '🌅' : log.meal_type === 'lunch' ? '☀️' : log.meal_type === 'dinner' ? '🌙' : log.meal_type === 'snack' ? '🍿' : '🍽️'}
                      </span>
                      <div>
                        <p className="font-medium text-foreground capitalize text-sm">{log.meal_type || 'Meal'}</p>
                        <p className="text-[11px] text-muted-foreground">{format(new Date(log.created_at), 'MMM dd, yyyy · HH:mm')}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-foreground text-sm">{log.calories} kcal</p>
                      <p className="text-[10px] text-muted-foreground">
                        C:{log.carbs_grams || 0}g P:{log.protein_grams || 0}g F:{log.fats_grams || 0}g
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
