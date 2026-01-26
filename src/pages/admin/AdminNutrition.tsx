import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { Flame, Users, TrendingUp, Apple, Search } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear, subDays, eachDayOfInterval, eachHourOfInterval, eachMonthOfInterval } from 'date-fns';

type TimePeriod = 'today' | 'week' | 'month' | 'year';

interface CalorieLog {
  id: string;
  user_id: string;
  calories: number;
  carbs_grams: number | null;
  protein_grams: number | null;
  fats_grams: number | null;
  log_date: string;
  created_at: string;
}

interface UserNutritionStats {
  userId: string;
  fullName: string;
  totalCalories: number;
  avgDailyCalories: number;
  topFoodClass: string;
  carbsTotal: number;
  proteinTotal: number;
  fatsTotal: number;
  lastActivity: string;
}

const COLORS = ['hsl(var(--primary))', 'hsl(var(--destructive))', 'hsl(142, 76%, 36%)', 'hsl(45, 93%, 47%)'];

export default function AdminNutrition() {
  const navigate = useNavigate();
  const { role, loading: permissionsLoading } = useAdminPermissions();
  const isAdmin = role !== null;
  const [isLoading, setIsLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>('month');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [logs, setLogs] = useState<CalorieLog[]>([]);
  const [profiles, setProfiles] = useState<{ user_id: string; full_name: string | null }[]>([]);
  
  // Stats
  const [totalCalories, setTotalCalories] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [avgDailyIntake, setAvgDailyIntake] = useState(0);
  const [topFoodClass, setTopFoodClass] = useState('N/A');
  
  // Chart data
  const [foodClassData, setFoodClassData] = useState<{ name: string; value: number }[]>([]);
  const [trendData, setTrendData] = useState<{ date: string; calories: number }[]>([]);
  const [userStats, setUserStats] = useState<UserNutritionStats[]>([]);

  useEffect(() => {
    if (!permissionsLoading && !isAdmin) {
      navigate('/admin/auth');
    }
  }, [isAdmin, permissionsLoading, navigate]);

  useEffect(() => {
    if (isAdmin) {
      fetchNutritionData();
    }
  }, [isAdmin, period]);

  const getDateRange = (p: TimePeriod): { start: Date; end: Date } => {
    const now = new Date();
    switch (p) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'week':
        return { start: startOfWeek(now), end: endOfWeek(now) };
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) };
      case 'year':
        return { start: startOfYear(now), end: endOfYear(now) };
    }
  };

  const fetchNutritionData = async () => {
    setIsLoading(true);
    try {
      const { start, end } = getDateRange(period);
      
      // Fetch calorie logs
      const { data: logsData } = await supabase
        .from('calorie_logs')
        .select('*')
        .gte('log_date', format(start, 'yyyy-MM-dd'))
        .lte('log_date', format(end, 'yyyy-MM-dd'));

      const fetchedLogs = logsData || [];
      setLogs(fetchedLogs);

      // Fetch profiles for user names
      const userIds = [...new Set(fetchedLogs.map(l => l.user_id))];
      let profilesData: { user_id: string; full_name: string | null }[] = [];
      if (userIds.length > 0) {
        const { data } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', userIds);
        profilesData = data || [];
      }
      setProfiles(profilesData);

      // Calculate stats
      calculateStats(fetchedLogs, profilesData);
      calculateFoodClassDistribution(fetchedLogs);
      calculateTrendData(fetchedLogs, start, end);
      calculateUserStats(fetchedLogs, profilesData);

    } catch (error) {
      console.error('Error fetching nutrition data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const calculateStats = (logsData: CalorieLog[], profilesData: { user_id: string; full_name: string | null }[]) => {
    const total = logsData.reduce((sum, log) => sum + (log.calories || 0), 0);
    setTotalCalories(total);

    const uniqueUsers = new Set(logsData.map(l => l.user_id)).size;
    setTotalUsers(uniqueUsers);

    const uniqueDays = new Set(logsData.map(l => l.log_date)).size;
    setAvgDailyIntake(uniqueDays > 0 && uniqueUsers > 0 ? Math.round(total / uniqueDays / uniqueUsers) : 0);

    // Calculate top food class
    const totals = logsData.reduce((acc, log) => ({
      carbs: acc.carbs + (log.carbs_grams || 0),
      protein: acc.protein + (log.protein_grams || 0),
      fats: acc.fats + (log.fats_grams || 0),
    }), { carbs: 0, protein: 0, fats: 0 });

    const classes = [
      { name: 'Carbohydrates', value: totals.carbs },
      { name: 'Protein', value: totals.protein },
      { name: 'Fats', value: totals.fats },
    ];
    const top = classes.sort((a, b) => b.value - a.value)[0];
    setTopFoodClass(top.value > 0 ? top.name : 'N/A');
  };

  const calculateFoodClassDistribution = (logsData: CalorieLog[]) => {
    const totals = logsData.reduce((acc, log) => ({
      carbs: acc.carbs + (log.carbs_grams || 0),
      protein: acc.protein + (log.protein_grams || 0),
      fats: acc.fats + (log.fats_grams || 0),
    }), { carbs: 0, protein: 0, fats: 0 });

    const data = [
      { name: 'Carbohydrates', value: Math.round(totals.carbs) },
      { name: 'Protein', value: Math.round(totals.protein) },
      { name: 'Fats', value: Math.round(totals.fats) },
    ].filter(d => d.value > 0);

    setFoodClassData(data);
  };

  const calculateTrendData = (logsData: CalorieLog[], start: Date, end: Date) => {
    let intervals: Date[];
    let formatStr: string;

    switch (period) {
      case 'today':
        intervals = eachHourOfInterval({ start, end });
        formatStr = 'HH:00';
        break;
      case 'week':
        intervals = eachDayOfInterval({ start, end });
        formatStr = 'EEE';
        break;
      case 'month':
        intervals = eachDayOfInterval({ start, end });
        formatStr = 'dd';
        break;
      case 'year':
        intervals = eachMonthOfInterval({ start, end });
        formatStr = 'MMM';
        break;
    }

    const data = intervals.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const hourStr = format(date, 'HH');
      
      let dayLogs: CalorieLog[];
      if (period === 'today') {
        dayLogs = logsData.filter(l => {
          const logDate = new Date(l.created_at);
          return format(logDate, 'yyyy-MM-dd') === dateStr && format(logDate, 'HH') === hourStr;
        });
      } else if (period === 'year') {
        const monthStr = format(date, 'yyyy-MM');
        dayLogs = logsData.filter(l => l.log_date.startsWith(monthStr));
      } else {
        dayLogs = logsData.filter(l => l.log_date === dateStr);
      }
      
      const calories = dayLogs.reduce((sum, log) => sum + (log.calories || 0), 0);
      
      return {
        date: format(date, formatStr),
        calories,
      };
    });

    setTrendData(data);
  };

  const calculateUserStats = (logsData: CalorieLog[], profilesData: { user_id: string; full_name: string | null }[]) => {
    const userIds = [...new Set(logsData.map(l => l.user_id))];
    
    const stats: UserNutritionStats[] = userIds.map(userId => {
      const userLogs = logsData.filter(l => l.user_id === userId);
      const profile = profilesData.find(p => p.user_id === userId);
      const uniqueDays = new Set(userLogs.map(l => l.log_date)).size;
      
      const totals = userLogs.reduce((acc, log) => ({
        calories: acc.calories + (log.calories || 0),
        carbs: acc.carbs + (log.carbs_grams || 0),
        protein: acc.protein + (log.protein_grams || 0),
        fats: acc.fats + (log.fats_grams || 0),
      }), { calories: 0, carbs: 0, protein: 0, fats: 0 });

      const classes = [
        { name: 'Carbs', value: totals.carbs },
        { name: 'Protein', value: totals.protein },
        { name: 'Fats', value: totals.fats },
      ];
      const topClass = classes.sort((a, b) => b.value - a.value)[0];

      return {
        userId,
        fullName: profile?.full_name || 'Unknown User',
        totalCalories: totals.calories,
        avgDailyCalories: uniqueDays > 0 ? Math.round(totals.calories / uniqueDays) : 0,
        topFoodClass: topClass.value > 0 ? topClass.name : 'N/A',
        carbsTotal: Math.round(totals.carbs),
        proteinTotal: Math.round(totals.protein),
        fatsTotal: Math.round(totals.fats),
        lastActivity: userLogs[0]?.created_at || '',
      };
    });

    stats.sort((a, b) => b.totalCalories - a.totalCalories);
    setUserStats(stats);
  };

  const filteredUserStats = userStats.filter(u => 
    u.fullName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatNumber = (num: number) => num.toLocaleString();

  if (permissionsLoading || isLoading) {
    return (
      <div className="flex min-h-screen bg-background">
        <AdminSidebar />
        <main className="flex-1 p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/4" />
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-muted rounded" />)}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <AdminSidebar />
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Nutrition Analytics</h1>
          <p className="text-muted-foreground">Consumer calorie and food class consumption data</p>
        </div>

        {/* Platform Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                  <Flame className="w-5 h-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Calories</p>
                  <p className="text-2xl font-bold text-foreground">{formatNumber(totalCalories)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <Users className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Users Tracking</p>
                  <p className="text-2xl font-bold text-foreground">{totalUsers}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg Daily Intake</p>
                  <p className="text-2xl font-bold text-foreground">{formatNumber(avgDailyIntake)} kcal</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <Apple className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Top Food Class</p>
                  <p className="text-2xl font-bold text-foreground">{topFoodClass}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Time Period Selector */}
        <Tabs value={period} onValueChange={(v) => setPeriod(v as TimePeriod)}>
          <TabsList>
            <TabsTrigger value="today">Today</TabsTrigger>
            <TabsTrigger value="week">This Week</TabsTrigger>
            <TabsTrigger value="month">This Month</TabsTrigger>
            <TabsTrigger value="year">This Year</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Food Class Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Food Class Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {foodClassData.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={foodClassData}
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      fill="hsl(var(--primary))"
                      dataKey="value"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    >
                      {foodClassData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `${value}g`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No data available for this period
                </div>
              )}
            </CardContent>
          </Card>

          {/* Calorie Trends */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Calorie Trends</CardTitle>
            </CardHeader>
            <CardContent>
              {trendData.some(d => d.calories > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  {period === 'today' || period === 'week' ? (
                    <BarChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }} 
                      />
                      <Bar dataKey="calories" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  ) : (
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }} 
                      />
                      <Line type="monotone" dataKey="calories" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              ) : (
                <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                  No data available for this period
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Per-Consumer Breakdown */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle className="text-lg">Per-Consumer Breakdown</CardTitle>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredUserStats.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead className="text-right">Total Calories</TableHead>
                      <TableHead className="text-right">Avg/Day</TableHead>
                      <TableHead className="text-right">Carbs (g)</TableHead>
                      <TableHead className="text-right">Protein (g)</TableHead>
                      <TableHead className="text-right">Fats (g)</TableHead>
                      <TableHead>Top Class</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUserStats.map((user) => (
                      <TableRow key={user.userId}>
                        <TableCell className="font-medium">{user.fullName}</TableCell>
                        <TableCell className="text-right">{formatNumber(user.totalCalories)}</TableCell>
                        <TableCell className="text-right">{formatNumber(user.avgDailyCalories)}</TableCell>
                        <TableCell className="text-right">{formatNumber(user.carbsTotal)}</TableCell>
                        <TableCell className="text-right">{formatNumber(user.proteinTotal)}</TableCell>
                        <TableCell className="text-right">{formatNumber(user.fatsTotal)}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            user.topFoodClass === 'Carbs' ? 'bg-primary/10 text-primary' :
                            user.topFoodClass === 'Protein' ? 'bg-destructive/10 text-destructive' :
                            user.topFoodClass === 'Fats' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-500' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            {user.topFoodClass}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                {searchTerm ? 'No users match your search' : 'No nutrition data available for this period'}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
