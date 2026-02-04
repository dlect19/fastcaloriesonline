import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  ChevronDown, 
  Info, 
  CheckCircle2, 
  XCircle,
  Percent,
  Wallet,
  Gift,
  CreditCard,
  Truck
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface EarningsExplanationProps {
  userType: 'vendor' | 'rider' | 'delivery_company';
  commissionRate?: number;
}

export function EarningsExplanation({ userType, commissionRate = 15 }: EarningsExplanationProps) {
  const [isOpen, setIsOpen] = useState(false);

  const getExplanationContent = () => {
    switch (userType) {
      case 'vendor':
        return {
          title: "Understanding Your Earnings",
          description: "How your revenue is calculated",
          items: [
            {
              icon: Percent,
              title: `Commission Rate: ${commissionRate}%`,
              description: "Platform commission is calculated on the menu price only (before delivery fees and discounts).",
              included: false,
            },
            {
              icon: Truck,
              title: "Delivery Fees",
              description: "Delivery fees go to riders. If you have affiliated riders, 80% of delivery fees come to you.",
              included: true,
            },
            {
              icon: CreditCard,
              title: "Service Fees",
              description: "Service fees are paid by customers to the platform. They are NOT deducted from your earnings.",
              included: true,
            },
            {
              icon: Gift,
              title: "Promo Discounts",
              description: "Promotional discounts are absorbed by the platform. You always receive your full share based on menu price.",
              included: true,
            },
          ],
          example: {
            gross: 5000,
            commissionRate,
            commission: 5000 * (commissionRate / 100),
            net: 5000 - (5000 * (commissionRate / 100)),
          },
        };
      case 'rider':
        return {
          title: "Understanding Your Earnings",
          description: "How delivery earnings are calculated",
          items: [
            {
              icon: Percent,
              title: `Your Share: ${100 - commissionRate}%`,
              description: "You receive 80% of every delivery fee. The platform retains 20% as commission.",
              included: true,
            },
            {
              icon: Wallet,
              title: "Immediate Availability",
              description: "Your earnings are available for withdrawal immediately after delivery completion.",
              included: true,
            },
            {
              icon: Gift,
              title: "No Promo Deductions",
              description: "Promotional discounts are paid by the platform. Your delivery fee share is never reduced.",
              included: true,
            },
          ],
          example: {
            gross: 1500,
            commissionRate: 20,
            commission: 300,
            net: 1200,
          },
        };
      case 'delivery_company':
        return {
          title: "How Earnings Work",
          description: "Understanding your delivery revenue",
          items: [
            {
              icon: Percent,
              title: `Your Share: ${100 - commissionRate}%`,
              description: `You receive ${100 - commissionRate}% of all delivery fees from your riders. Platform retains ${commissionRate}%.`,
              included: true,
            },
            {
              icon: Wallet,
              title: "Immediate Availability",
              description: "Revenue is credited to your wallet immediately when deliveries are completed.",
              included: true,
            },
            {
              icon: Gift,
              title: "No Promo Deductions",
              description: "Promo costs are absorbed by the platform. Your delivery revenue is never affected.",
              included: true,
            },
          ],
          example: {
            gross: 1500,
            commissionRate,
            commission: 1500 * (commissionRate / 100),
            net: 1500 - (1500 * (commissionRate / 100)),
          },
        };
    }
  };

  const content = getExplanationContent();
  const formatCurrency = (amount: number) => `₦${amount.toLocaleString()}`;

  return (
    <Card className="border-0 shadow-soft">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Info className="w-5 h-5 text-primary" />
                </div>
                <div className="text-left">
                  <CardTitle className="text-base">{content.title}</CardTitle>
                  <CardDescription>{content.description}</CardDescription>
                </div>
              </div>
              <ChevronDown className={cn("w-5 h-5 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4 pt-0">
            {/* Explanation Items */}
            <div className="space-y-3">
              {content.items.map((item, index) => (
                <div 
                  key={index} 
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg",
                    item.included ? "bg-success/5" : "bg-muted/50"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
                    item.included ? "bg-success/10" : "bg-muted"
                  )}>
                    <item.icon className={cn("w-4 h-4", item.included ? "text-success" : "text-muted-foreground")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{item.title}</p>
                      {item.included ? (
                        <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Example Calculation */}
            <div className="bg-muted/30 rounded-xl p-4 space-y-2">
              <p className="text-sm font-medium text-center mb-3">Example Calculation</p>
              <div className="font-mono text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{userType === 'vendor' ? 'Order Total (Menu)' : 'Delivery Fee'}:</span>
                  <span className="text-success">{formatCurrency(content.example.gross)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Commission ({content.example.commissionRate}%):</span>
                  <span className="text-destructive">-{formatCurrency(content.example.commission)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border font-bold">
                  <span>Your Earnings:</span>
                  <span className="text-primary">{formatCurrency(content.example.net)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
