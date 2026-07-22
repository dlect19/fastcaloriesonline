import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

export interface VoucherPreviewData {
  vendorName: string;
  vendorLogoUrl?: string | null;
  categoryName: string;
  code: string;
  expiryDate: Date | string;
  purchasedAt: Date | string;
  backgroundColor?: string | null;
  backgroundImageUrl?: string | null;
  amount?: number;
}

export interface VoucherPreviewHandle {
  toBlob: () => Promise<Blob | null>;
  toDataURL: () => string | null;
}

/**
 * Fixed-layout voucher canvas.
 * Renders vendor logo, name, category, code, expiry & purchase timestamps.
 */
export const VoucherPreview = forwardRef<VoucherPreviewHandle, VoucherPreviewData>(
  function VoucherPreview(props, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useImperativeHandle(ref, () => ({
      toBlob: () =>
        new Promise((resolve) => {
          const c = canvasRef.current;
          if (!c) return resolve(null);
          c.toBlob((b) => resolve(b), 'image/png');
        }),
      toDataURL: () => canvasRef.current?.toDataURL('image/png') ?? null,
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;

      const draw = (bgImage?: HTMLImageElement | null, logoImage?: HTMLImageElement | null) => {
        // Background
        if (bgImage) {
          ctx.drawImage(bgImage, 0, 0, W, H);
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(0, 0, W, H);
        } else {
          ctx.fillStyle = props.backgroundColor || '#0F172A';
          ctx.fillRect(0, 0, W, H);
        }

        // Header
        if (logoImage) {
          const size = 90;
          const radius = 12;
          const x = 40, y = 40;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x + radius, y);
          ctx.arcTo(x + size, y, x + size, y + size, radius);
          ctx.arcTo(x + size, y + size, x, y + size, radius);
          ctx.arcTo(x, y + size, x, y, radius);
          ctx.arcTo(x, y, x + size, y, radius);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(logoImage, x, y, size, size);
          ctx.restore();
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 30px Inter, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(props.vendorName, 150, 75);
        ctx.font = '18px Inter, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(props.categoryName, 150, 105);

        // Divider
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        ctx.moveTo(40, 160);
        ctx.lineTo(W - 40, 160);
        ctx.stroke();

        // Code block
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        roundRect(ctx, 40, 190, W - 80, 130, 16);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '14px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('VOUCHER CODE', W / 2, 220);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 46px "Courier New", monospace';
        ctx.fillText(props.code, W / 2, 285);

        // Amount
        if (typeof props.amount === 'number') {
          ctx.font = 'bold 22px Inter, Arial, sans-serif';
          ctx.fillStyle = '#22c55e';
          ctx.fillText(`₦${props.amount.toLocaleString()}`, W / 2, 355);
        }

        // Footer meta
        const purchasedAt = new Date(props.purchasedAt);
        const expiry = new Date(props.expiryDate);
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = '13px Inter, Arial, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`Purchased: ${purchasedAt.toLocaleString()}`, 40, H - 60);
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 13px Inter, Arial, sans-serif';
        ctx.fillText(`Expires: ${expiry.toLocaleString()}`, 40, H - 35);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.textAlign = 'right';
        ctx.font = '11px Inter, Arial, sans-serif';
        ctx.fillText('FastCalories Voucher Hub', W - 40, H - 20);
      };

      const loadImg = (url?: string | null) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          if (!url) return resolve(null);
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = url;
        });

      Promise.all([loadImg(props.backgroundImageUrl), loadImg(props.vendorLogoUrl)]).then(
        ([bg, logo]) => draw(bg, logo)
      );
    }, [
      props.vendorName,
      props.vendorLogoUrl,
      props.categoryName,
      props.code,
      props.expiryDate,
      props.purchasedAt,
      props.backgroundColor,
      props.backgroundImageUrl,
      props.amount,
    ]);

    return (
      <canvas
        ref={canvasRef}
        width={640}
        height={420}
        className="w-full max-w-md rounded-xl shadow-lg border border-border"
      />
    );
  }
);

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
