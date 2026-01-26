

# Plan: Consumer Nutrition Analytics Dashboard

## Overview

Create a new "Nutrition Analytics" page in the admin portal that provides comprehensive reporting on consumer calorie consumption and food class distribution. The dashboard will display data in daily, monthly, and yearly views with visual charts for demographic analysis.

---

## Data Sources

The feature will leverage existing tables:

| Table | Data Used |
|-------|-----------|
| `calorie_logs` | User calorie consumption, macros, meal types, dates |
| `order_items` | Calories per item, product references |
| `products` | Calorie classes (carbs, protein, fats, fiber), nutrient data |
| `profiles` | User info for per-consumer breakdown |

---

## Implementation Tasks

### Task 1: Add Nutrition Analytics to Admin Sidebar

**File**: `src/components/admin/AdminSidebar.tsx`

Add new menu item:
```typescript
{ icon: Activity, label: 'Nutrition', path: '/admin/nutrition' },
```

---

### Task 2: Create Admin Nutrition Analytics Page

**New File**: `src/pages/admin/AdminNutrition.tsx`

#### Section 1: Platform Nutrition Overview (Top Cards)
- **Total Calories Consumed**: Sum of all calorie_logs
- **Total Users Tracking**: Count of unique users with calorie_logs
- **Average Daily Intake**: Average calories per user per day
- **Most Popular Food Class**: Most consumed class (carbs/protein/fats/fiber)

#### Section 2: Time Period Selector
- Tabs or dropdown for: **Today**, **This Week**, **This Month**, **This Year**
- Date range picker for custom ranges

#### Section 3: Food Class Distribution (Pie Chart)
- Visual breakdown showing percentage of:
  - Carbohydrates consumption
  - Protein consumption
  - Fats consumption
  - Fiber consumption
- Use `recharts` PieChart component

#### Section 4: Calorie Trends (Line/Bar Chart)
- **Daily View**: Calories consumed per hour of day
- **Weekly View**: Calories consumed per day of week
- **Monthly View**: Calories consumed per day of month
- **Yearly View**: Calories consumed per month

#### Section 5: Per-Consumer Breakdown (Table)
- Columns: User Name, Total Calories, Avg Daily, Top Food Class, Last Activity
- Sortable and searchable
- Click to expand: Show detailed breakdown per user

---

### Task 3: Add Route to App.tsx

**File**: `src/App.tsx`

Add route:
```typescript
<Route path="/admin/nutrition" element={<AdminNutrition />} />
```

---

## Technical Details

### Data Fetching Strategy

```typescript
// Fetch calorie logs with date filtering
const fetchNutritionData = async (startDate: Date, endDate: Date) => {
  // Get all calorie logs in range
  const { data: logs } = await supabase
    .from('calorie_logs')
    .select('*')
    .gte('log_date', startDate.toISOString().split('T')[0])
    .lte('log_date', endDate.toISOString().split('T')[0]);

  // Get order items with product info for food classes
  const { data: orderItems } = await supabase
    .from('order_items')
    .select('*, products(calorie_classes, calories)')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString());

  // Get user profiles for names
  const userIds = [...new Set(logs?.map(l => l.user_id) || [])];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, full_name')
    .in('user_id', userIds);

  return { logs, orderItems, profiles };
};
```

### Chart Components Using Recharts

```typescript
// Pie Chart for Food Class Distribution
<PieChart>
  <Pie data={foodClassData} dataKey="value" nameKey="name" />
  <Tooltip />
  <Legend />
</PieChart>

// Line Chart for Trends
<LineChart data={trendData}>
  <XAxis dataKey="date" />
  <YAxis />
  <Line type="monotone" dataKey="calories" stroke="#22c55e" />
  <Tooltip />
</LineChart>
```

### Per-User Statistics Calculation

```typescript
interface UserNutritionStats {
  userId: string;
  fullName: string;
  totalCalories: number;
  avgDailyCalories: number;
  topFoodClass: 'carbs' | 'protein' | 'fats' | 'fiber';
  carbsTotal: number;
  proteinTotal: number;
  fatsTotal: number;
  fiberTotal: number;
  lastActivity: string;
}

const calculateUserStats = (logs: CalorieLog[], userId: string): UserNutritionStats => {
  const userLogs = logs.filter(l => l.user_id === userId);
  const uniqueDays = new Set(userLogs.map(l => l.log_date)).size;
  
  const totals = userLogs.reduce((acc, log) => ({
    calories: acc.calories + (log.calories || 0),
    carbs: acc.carbs + (log.carbs_grams || 0),
    protein: acc.protein + (log.protein_grams || 0),
    fats: acc.fats + (log.fats_grams || 0),
  }), { calories: 0, carbs: 0, protein: 0, fats: 0 });

  // Determine top food class by grams consumed
  const classes = [
    { name: 'carbs', value: totals.carbs },
    { name: 'protein', value: totals.protein },
    { name: 'fats', value: totals.fats },
  ];
  const topClass = classes.sort((a, b) => b.value - a.value)[0];

  return {
    userId,
    totalCalories: totals.calories,
    avgDailyCalories: uniqueDays > 0 ? Math.round(totals.calories / uniqueDays) : 0,
    topFoodClass: topClass.name as 'carbs' | 'protein' | 'fats',
    carbsTotal: totals.carbs,
    proteinTotal: totals.protein,
    fatsTotal: totals.fats,
    lastActivity: userLogs[0]?.created_at || '',
  };
};
```

---

## UI Layout

```
+------------------------------------------------------------------+
|  Nutrition Analytics                                              |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
|  Platform Overview                                                |
|  +------------+ +------------+ +------------+ +------------+     |
|  | Total      | | Users      | | Avg Daily  | | Top Food   |     |
|  | Calories   | | Tracking   | | Intake     | | Class      |     |
|  +------------+ +------------+ +------------+ +------------+     |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
|  [ Today ] [ Week ] [ Month ] [ Year ] [ Custom ]                |
+------------------------------------------------------------------+

+----------------------------------+-------------------------------+
|  Food Class Distribution         |  Calorie Trends               |
|  [======= Pie Chart =======]     |  [====== Line Chart ======]   |
|  - Carbs: 45%                    |  Shows consumption over time  |
|  - Protein: 30%                  |                               |
|  - Fats: 20%                     |                               |
|  - Fiber: 5%                     |                               |
+----------------------------------+-------------------------------+

+------------------------------------------------------------------+
|  Per-Consumer Breakdown                                           |
|  +-------+-------------+----------+--------+----------+--------+ |
|  | User  | Total Cals  | Avg/Day  | Carbs  | Protein  | Fats   | |
|  +-------+-------------+----------+--------+----------+--------+ |
|  | John  | 45,230      | 2,150    | 2,100g | 1,200g   | 890g   | |
|  | Jane  | 38,500      | 1,830    | 1,800g | 1,100g   | 750g   | |
|  +-------+-------------+----------+--------+----------+--------+ |
+------------------------------------------------------------------+
```

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `src/components/admin/AdminSidebar.tsx` | Modify | Add "Nutrition" menu item |
| `src/pages/admin/AdminNutrition.tsx` | Create | New analytics page with charts |
| `src/App.tsx` | Modify | Add route for `/admin/nutrition` |

---

## Expected Outcome

After implementation, admins will be able to:
1. View total platform calorie consumption statistics
2. See food class distribution as a pie chart
3. Track calorie trends over time (day/week/month/year)
4. View per-user nutrition breakdown
5. Filter data by custom date ranges
6. Identify popular food classes and consumption patterns

---

## Dependencies

- `recharts` (already installed) - For PieChart and LineChart visualization
- No database migrations needed - Uses existing calorie_logs and products tables

