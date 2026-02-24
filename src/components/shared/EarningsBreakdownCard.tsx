import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Info, TrendingUp, Wallet } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface Deduction {
  label: string;
  amount: number;
  percentage?: number;
  description?: string;
}

interface EarningsBreakdownProps {
  grossAmount: number;
  deductions: Deduction[];
  netAmount: number;
  title?: string;
  period?: string;
  showFormula?: boolean;
  className?: string;
}

export function EarningsBreakdownCard({
  grossAmount,
  deductions,
  netAmount,
  title = "Earnings Breakdown",
  period,
  showFormula = true,
  className,
}: EarningsBreakdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;
  
  const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
  const netPercentage = grossAmount > 0 ? (netAmount / grossAmount) * 100 : 0;

  return (
    <Card className={cn("border-0 shadow-soft", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              {title}
            </CardTitle>
            {period && (
              <CardDescription>{period}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Visual Breakdown */}
        <div className="space-y-4">
          {/* Gross Amount */}
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                <ArrowDownLeft className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="font-medium text-foreground">Gross Revenue</p>
                <p className="text-xs text-muted-foreground">Total before deductions</p>
              </div>
            </div>
            <p className="text-xl font-bold text-success">{formatCurrency(grossAmount)}</p>
          </div>

          {/* Deductions & Bonuses */}
          {deductions.map((deduction, index) => {
            const isBonus = deduction.amount < 0;
            return (
              <div key={index} className={cn(
                "flex items-center justify-between p-4 rounded-xl",
                isBonus ? "bg-success/5" : "bg-destructive/5"
              )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center",
                    isBonus ? "bg-success/10" : "bg-destructive/10"
                  )}>
                    {isBonus 
                      ? <ArrowDownLeft className="w-5 h-5 text-success" />
                      : <ArrowUpRight className="w-5 h-5 text-destructive" />
                    }
                  </div>
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="font-medium text-foreground">{deduction.label}</p>
                      {deduction.percentage != null && deduction.percentage > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {deduction.percentage}% of gross
                        </p>
                      )}
                    </div>
                    {deduction.description && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="w-4 h-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="max-w-xs">{deduction.description}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </div>
                <p className={cn(
                  "text-xl font-bold",
                  isBonus ? "text-success" : "text-destructive"
                )}>
                  {isBonus ? `+${formatCurrency(Math.abs(deduction.amount))}` : `-${formatCurrency(deduction.amount)}`}
                </p>
              </div>
            );
          })}

          {/* Net Amount */}
          <div className="flex items-center justify-between p-4 bg-primary/10 rounded-xl border-2 border-primary/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
                <Wallet className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground">Net Earnings</p>
                <p className="text-xs text-muted-foreground">Your actual revenue</p>
              </div>
            </div>
            <p className="text-2xl font-bold text-primary">{formatCurrency(netAmount)}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Your Share</span>
            <span className="font-medium">{netPercentage.toFixed(1)}%</span>
          </div>
          <Progress value={netPercentage} className="h-3" />
        </div>

        {/* Formula Visualization */}
        {showFormula && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full justify-center">
              <span>View calculation</span>
              <ChevronDown className={cn("w-4 h-4 transition-transform", isOpen && "rotate-180")} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <div className="bg-muted/30 rounded-xl p-4 font-mono text-sm text-center space-y-2">
                <div className="text-success">{formatCurrency(grossAmount)} (Gross)</div>
                {deductions.map((d, i) => (
                  <div key={i} className="text-destructive">- {formatCurrency(d.amount)} ({d.label})</div>
                ))}
                <div className="border-t border-border pt-2 text-primary font-bold">
                  = {formatCurrency(netAmount)} (Net)
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
