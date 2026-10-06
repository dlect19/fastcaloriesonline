import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const rules = [
  ['Sponsor', 'The FastCalories Spin & Win promotion is operated and sponsored by Dlect Technologies Limited, operator of FastCalories.'],
  ['Eligibility', 'The promotion is available to eligible registered FastCalories users in supported service areas in Nigeria, subject to these Official Rules and applicable laws.'],
  ['How to Participate', 'Eligible users may receive one free Spin & Win opportunity each day. No purchase is required to participate in the iOS version of the promotion.'],
  ['Available Rewards', 'A spin may result in a discount reward of 0%, 2%, 5%, 8%, or 10%, or a “Try Again” result. The result of each spin is determined by the Spin & Win system.'],
  ['Discount Usage', 'Any discount awarded is valid for 24 hours after it is awarded and may be used only on eligible FastCalories orders in accordance with conditions displayed in the app. Only one Spin & Win discount may be applied to an eligible order.'],
  ['No Cash Value', 'Spin & Win discounts and promotional rewards have no cash value, cannot be transferred, cannot be exchanged for cash, and cannot be withdrawn from a FastCalories wallet.'],
  ['Fair Use', 'FastCalories may restrict participation in cases of fraud, abuse, manipulation, multiple-account abuse, or attempts to interfere with the operation of the promotion.'],
  ['Promotion Changes', 'FastCalories may modify, suspend, or discontinue the promotion where reasonably necessary, subject to applicable law.'],
  ['Apple Disclaimer', 'Apple Inc. is not a sponsor of, affiliated with, responsible for, or involved in the FastCalories Spin & Win promotion in any manner.'],
];

export function OfficialSpinRules() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full h-auto min-h-11 whitespace-normal gap-2">
          <FileText className="w-4 h-4 shrink-0" />
          Official Spin &amp; Win Rules
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto rounded-lg">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">FastCalories Spin &amp; Win – Official Rules</DialogTitle>
          <DialogDescription>By participating in FastCalories Spin &amp; Win, the user agrees to these Official Rules.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm leading-relaxed">
          {rules.map(([heading, text]) => (
            <section key={heading}>
              <h3 className="font-semibold text-foreground">{heading}</h3>
              <p className="text-muted-foreground">{text}</p>
            </section>
          ))}
          <p className="text-foreground">By participating in FastCalories Spin &amp; Win, the user agrees to these Official Rules.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}