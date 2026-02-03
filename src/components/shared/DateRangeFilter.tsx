import { useState } from 'react';
import { format, startOfDay, endOfDay, subDays, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek } from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

interface DateRangeFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  className?: string;
}

type PresetOption = 'all' | 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'last_7_days' | 'last_30_days' | 'custom';

export function DateRangeFilter({ dateRange, onDateRangeChange, className }: DateRangeFilterProps) {
  const [preset, setPreset] = useState<PresetOption>('all');
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  const handlePresetChange = (value: PresetOption) => {
    setPreset(value);
    const now = new Date();

    switch (value) {
      case 'all':
        onDateRangeChange({ from: undefined, to: undefined });
        break;
      case 'today':
        onDateRangeChange({ from: startOfDay(now), to: endOfDay(now) });
        break;
      case 'yesterday':
        const yesterday = subDays(now, 1);
        onDateRangeChange({ from: startOfDay(yesterday), to: endOfDay(yesterday) });
        break;
      case 'this_week':
        onDateRangeChange({ from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) });
        break;
      case 'last_week':
        const lastWeek = subDays(now, 7);
        onDateRangeChange({ from: startOfWeek(lastWeek, { weekStartsOn: 1 }), to: endOfWeek(lastWeek, { weekStartsOn: 1 }) });
        break;
      case 'this_month':
        onDateRangeChange({ from: startOfMonth(now), to: endOfMonth(now) });
        break;
      case 'last_month':
        const lastMonth = subMonths(now, 1);
        onDateRangeChange({ from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) });
        break;
      case 'last_7_days':
        onDateRangeChange({ from: subDays(now, 7), to: endOfDay(now) });
        break;
      case 'last_30_days':
        onDateRangeChange({ from: subDays(now, 30), to: endOfDay(now) });
        break;
      case 'custom':
        setIsCalendarOpen(true);
        break;
    }
  };

  const clearDateRange = () => {
    setPreset('all');
    onDateRangeChange({ from: undefined, to: undefined });
  };

  const formatDateRange = () => {
    if (!dateRange.from) return 'All time';
    if (!dateRange.to) return format(dateRange.from, 'MMM d, yyyy');
    if (dateRange.from.toDateString() === dateRange.to.toDateString()) {
      return format(dateRange.from, 'MMM d, yyyy');
    }
    return `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d, yyyy')}`;
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Select value={preset} onValueChange={(v) => handlePresetChange(v as PresetOption)}>
        <SelectTrigger className="w-[140px]">
          <CalendarIcon className="w-4 h-4 mr-2" />
          <SelectValue placeholder="Period" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Time</SelectItem>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="yesterday">Yesterday</SelectItem>
          <SelectItem value="this_week">This Week</SelectItem>
          <SelectItem value="last_week">Last Week</SelectItem>
          <SelectItem value="this_month">This Month</SelectItem>
          <SelectItem value="last_month">Last Month</SelectItem>
          <SelectItem value="last_7_days">Last 7 Days</SelectItem>
          <SelectItem value="last_30_days">Last 30 Days</SelectItem>
          <SelectItem value="custom">Custom Range</SelectItem>
        </SelectContent>
      </Select>

      {preset === 'custom' && (
        <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "justify-start text-left font-normal",
                !dateRange.from && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {formatDateRange()}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={dateRange.from}
              selected={{ from: dateRange.from, to: dateRange.to }}
              onSelect={(range) => {
                onDateRangeChange({ from: range?.from, to: range?.to });
              }}
              numberOfMonths={2}
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      )}

      {(dateRange.from || dateRange.to) && (
        <Button variant="ghost" size="icon" onClick={clearDateRange} className="h-8 w-8">
          <X className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
