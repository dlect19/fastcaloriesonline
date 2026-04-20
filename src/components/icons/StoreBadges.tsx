import type { ButtonHTMLAttributes, AnchorHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { AndroidIcon, AppleIcon } from '@/components/icons/BrandIcons';

type CommonProps = {
  className?: string;
  topLabel?: string;
  mainLabel?: string;
  loading?: boolean;
};

const baseClasses =
  'inline-flex items-center justify-center gap-3 h-14 min-w-[180px] px-5 rounded-xl bg-black text-white border border-white/10 shadow-lg hover:bg-neutral-900 active:scale-[0.98] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none';

function Inner({
  icon,
  topLabel,
  mainLabel,
}: {
  icon: React.ReactNode;
  topLabel: string;
  mainLabel: string;
}) {
  return (
    <>
      <span className="shrink-0">{icon}</span>
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[10px] font-normal tracking-wide opacity-90">{topLabel}</span>
        <span className="text-lg font-semibold -mt-0.5">{mainLabel}</span>
      </span>
    </>
  );
}

export function AppStoreBadge({
  className,
  topLabel = 'Available on the',
  mainLabel = 'App Store',
  ...rest
}: CommonProps & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cn(baseClasses, className)} {...rest}>
      <Inner icon={<AppleIcon className="w-7 h-7" />} topLabel={topLabel} mainLabel={mainLabel} />
    </a>
  );
}

export function GooglePlayBadge({
  className,
  topLabel = 'GET IT ON',
  mainLabel = 'Google Play',
  loading = false,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn(baseClasses, className)} disabled={loading || rest.disabled} {...rest}>
      <Inner
        icon={
          loading ? (
            <span className="w-7 h-7 inline-block border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <AndroidIcon className="w-7 h-7" />
          )
        }
        topLabel={loading ? 'Opening' : topLabel}
        mainLabel={mainLabel}
      />
    </button>
  );
}
