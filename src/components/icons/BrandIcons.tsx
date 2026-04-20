import type { SVGProps } from 'react';

/** Official Android robot mark (simplified, single-color via currentColor). */
export function AndroidIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M17.523 15.341a1.04 1.04 0 1 1 0-2.08 1.04 1.04 0 0 1 0 2.08m-11.046 0a1.04 1.04 0 1 1 0-2.08 1.04 1.04 0 0 1 0 2.08m11.42-6.02 2.073-3.59a.43.43 0 0 0-.158-.588.43.43 0 0 0-.588.158l-2.099 3.636A12.94 12.94 0 0 0 12 7.665c-1.872 0-3.65.398-5.234 1.111L4.667 5.14a.43.43 0 1 0-.745.43l2.073 3.59C2.43 11.135.36 14.092 0 17.605h24c-.36-3.513-2.43-6.47-6-8.284M7.5 12.7a.79.79 0 1 1 0-1.582.79.79 0 0 1 0 1.582m9 0a.79.79 0 1 1 0-1.582.79.79 0 0 1 0 1.582" />
    </svg>
  );
}

/** Apple logo mark. */
export function AppleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M17.05 20.28c-.98.95-2.05.86-3.08.43-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.43C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25" />
    </svg>
  );
}
