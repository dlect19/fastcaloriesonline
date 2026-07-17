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
  'group relative inline-flex items-center justify-center gap-3 h-14 min-w-[190px] px-6 rounded-2xl bg-gradient-to-br from-neutral-900 via-black to-neutral-900 text-white border border-white/15 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] hover:shadow-[0_16px_40px_-8px_rgba(0,0,0,0.7)] hover:-translate-y-0.5 hover:border-white/25 active:scale-[0.97] active:translate-y-0 transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none overflow-hidden isolate before:content-[""] before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent before:-translate-x-full group-hover:before:translate-x-full before:transition-transform before:duration-[900ms] before:ease-out after:content-[""] after:absolute after:-inset-[1px] after:rounded-2xl after:bg-gradient-to-r after:from-primary/0 after:via-primary/40 after:to-primary/0 after:opacity-0 hover:after:opacity-100 after:blur-md after:-z-10 after:transition-opacity after:duration-500';

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
      <span className="relative shrink-0 transition-transform duration-500 group-hover:rotate-[8deg] group-hover:scale-110">{icon}</span>
      <span className="relative flex flex-col items-start leading-tight">
        <span className="text-[10px] font-medium tracking-[0.14em] uppercase opacity-80">{topLabel}</span>
        <span className="text-lg font-semibold -mt-0.5 tracking-tight">{mainLabel}</span>
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
