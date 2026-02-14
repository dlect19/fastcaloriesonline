import { Checkbox } from '@/components/ui/checkbox';
import { ExternalLink } from 'lucide-react';

interface TermsAcceptanceCheckboxProps {
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  disabled?: boolean;
}

export function TermsAcceptanceCheckbox({ accepted, onAcceptedChange, disabled }: TermsAcceptanceCheckboxProps) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
      <Checkbox
        id="terms-acceptance"
        checked={accepted}
        onCheckedChange={(checked) => onAcceptedChange(checked === true)}
        disabled={disabled}
        className="mt-0.5"
      />
      <label htmlFor="terms-acceptance" className="text-sm text-muted-foreground leading-tight cursor-pointer">
        I have read and agree to the{' '}
        <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
          Terms & Conditions
          <ExternalLink className="w-3 h-3" />
        </a>{' '}
        and{' '}
        <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
          Privacy Policy
          <ExternalLink className="w-3 h-3" />
        </a>
      </label>
    </div>
  );
}
