import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, X, Share2 } from 'lucide-react';
import type { PosReceiptData } from '@/lib/escpos-printer';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: PosReceiptData | null;
  hasPrinter: boolean;
  onPrint: () => Promise<void> | void;
}

export function PosReceiptPreviewDialog({ open, onOpenChange, receipt, hasPrinter, onPrint }: Props) {
  if (!receipt) return null;

  const handleBrowserPrint = () => {
    // Use 80mm POS paper (most common). 58mm devices will scale down.
    // We omit page margins and trim trailing whitespace so the printer
    // does NOT eject a second blank page.
    const w = window.open('', '_blank', 'width=400,height=700');
    if (!w) return;
    const html = `
<!doctype html><html><head><meta charset="utf-8"><title>${receipt.receiptNumber}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Courier New', 'Consolas', monospace;
    font-size: 13px;
    font-weight: 700;            /* bold for thermal readability without overflow */
    width: 76mm;
    margin: 0 auto;
    padding: 2mm 2mm 0 2mm;       /* no bottom padding => no extra blank */
    color: #000;
    line-height: 1.25;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .store { text-align: center; font-size: 18px; font-weight: 900; margin: 3px 0; letter-spacing: 0.3px; }
  .meta-line { text-align: center; font-size: 12px; font-weight: 700; }
  .center { text-align: center; }
  .row { display: flex; justify-content: space-between; gap: 4px; font-size: 12px; font-weight: 700; }
  .row > span:last-child { text-align: right; white-space: nowrap; }
  .sep { border-top: 2px dashed #000; margin: 4px 0; }
  .item-name { font-size: 13px; font-weight: 900; word-break: break-word; margin-top: 3px; line-height: 1.2; }
  .item-line { font-size: 12px; font-weight: 700; }
  .cal { font-size: 11px; font-weight: 600; color: #222; }
  .total { font-size: 18px; font-weight: 900; margin-top: 4px; }
  .paid { font-size: 13px; font-weight: 800; }
  .footer { text-align: center; font-size: 13px; font-weight: 800; margin-top: 4px; }
  .powered { text-align: center; font-size: 10px; font-weight: 600; margin-top: 2px; }
  img.logo { max-width: 50mm; max-height: 20mm; display: block; margin: 0 auto 3px; }
  /* Kill page-breaks AFTER content so the browser doesn't add a blank page */
  body > :last-child { page-break-after: avoid; }
</style></head><body>
  ${receipt.storeLogoUrl ? `<img class="logo" src="${receipt.storeLogoUrl}"/>` : ''}
  <div class="store">${receipt.storeName}</div>
  ${receipt.storeAddress ? `<div class="meta-line">${receipt.storeAddress}</div>` : ''}
  ${receipt.storePhone ? `<div class="meta-line">Tel: ${receipt.storePhone}</div>` : ''}
  <div class="sep"></div>
  <div class="row"><span>Receipt#</span><span>${receipt.receiptNumber}</span></div>
  <div class="row"><span>Date</span><span>${receipt.date.toLocaleString()}</span></div>
  ${receipt.cashierName ? `<div class="row"><span>Cashier</span><span>${receipt.cashierName}</span></div>` : ''}
  ${receipt.customerName ? `<div class="row"><span>Customer</span><span>${receipt.customerName}</span></div>` : ''}
  ${receipt.customerPhone ? `<div class="row"><span>Phone</span><span>${receipt.customerPhone}</span></div>` : ''}
  <div class="sep"></div>
  ${receipt.items.map(it => `
    <div class="item-name">${it.qty} × ${it.name}</div>
    <div class="row item-line"><span>&nbsp;&nbsp;@ ₦${(it.price / Math.max(it.qty, 1)).toFixed(2)}</span><span>₦${it.price.toLocaleString()}</span></div>
    ${it.calories ? `<div class="cal">&nbsp;&nbsp;${(it.calories * it.qty).toFixed(0)} kcal</div>` : ''}
  `).join('')}
  <div class="sep"></div>
  <div class="row total"><span>TOTAL</span><span>₦${receipt.total.toLocaleString()}</span></div>
  <div class="row paid"><span>Paid (${receipt.paymentMethod})</span><span>₦${(receipt.amountPaid ?? receipt.total).toLocaleString()}</span></div>
  ${receipt.change && receipt.change > 0 ? `<div class="row paid"><span>Change</span><span>₦${receipt.change.toLocaleString()}</span></div>` : ''}
  ${receipt.totalCalories ? `<div class="sep"></div><div class="center">Total: ${receipt.totalCalories} kcal</div>` : ''}
  <div class="sep"></div>
  <div class="footer">Thank you for your purchase!</div>
  <div class="powered">Powered by Fast Calories</div>
  <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Receipt Preview</DialogTitle>
        </DialogHeader>

        {/* Receipt preview */}
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          <div
            className="mx-auto bg-white text-black border-2 rounded-lg p-3 font-mono leading-tight break-words"
            style={{ maxWidth: 302, fontWeight: 700 }}
          >
            {receipt.storeLogoUrl && (
              <div className="flex justify-center mb-2">
                <img src={receipt.storeLogoUrl} alt="" className="max-h-16" />
              </div>
            )}
            <p className="text-center font-black text-lg tracking-wide">{receipt.storeName}</p>
            {receipt.storeAddress && <p className="text-center text-xs font-bold">{receipt.storeAddress}</p>}
            {receipt.storePhone && <p className="text-center text-xs font-bold">Tel: {receipt.storePhone}</p>}

            <div className="border-t border-dashed border-black my-2" />

            <div className="flex justify-between text-xs font-bold gap-2"><span>Receipt#</span><span className="text-right">{receipt.receiptNumber}</span></div>
            <div className="flex justify-between text-xs font-bold gap-2"><span>Date</span><span className="text-right">{receipt.date.toLocaleString()}</span></div>
            {receipt.cashierName && <div className="flex justify-between text-xs font-bold gap-2"><span>Cashier</span><span className="text-right">{receipt.cashierName}</span></div>}
            {receipt.customerName && <div className="flex justify-between text-xs font-bold gap-2"><span>Customer</span><span className="text-right">{receipt.customerName}</span></div>}
            {receipt.customerPhone && <div className="flex justify-between text-xs font-bold gap-2"><span>Phone</span><span className="text-right">{receipt.customerPhone}</span></div>}

            <div className="border-t border-dashed border-black my-2" />

            {receipt.items.map((it, i) => (
              <div key={i} className="mb-1.5">
                <div className="text-sm font-black break-words leading-tight">{it.qty} × {it.name}</div>
                <div className="flex justify-between text-xs font-bold gap-2">
                  <span>&nbsp;&nbsp;@ ₦{(it.price / Math.max(it.qty, 1)).toFixed(2)}</span>
                  <span className="font-black whitespace-nowrap">₦{it.price.toLocaleString()}</span>
                </div>
                {it.calories ? <p className="text-[10px] font-semibold text-neutral-700">&nbsp;&nbsp;{(it.calories * it.qty).toFixed(0)} kcal</p> : null}
              </div>
            ))}

            <div className="border-t border-dashed border-black my-2" />

            <div className="flex justify-between font-black text-lg gap-2">
              <span>TOTAL</span><span className="whitespace-nowrap">₦{receipt.total.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm font-black mt-1 gap-2">
              <span>Paid ({receipt.paymentMethod})</span><span className="whitespace-nowrap">₦{(receipt.amountPaid ?? receipt.total).toLocaleString()}</span>
            </div>
            {receipt.change > 0 && (
              <div className="flex justify-between text-sm font-black gap-2">
                <span>Change</span><span className="whitespace-nowrap">₦{receipt.change.toLocaleString()}</span>
              </div>
            )}

            {receipt.totalCalories ? (
              <>
                <div className="border-t border-dashed border-black my-2" />
                <p className="text-center text-xs font-bold">Total: {receipt.totalCalories} kcal</p>
              </>
            ) : null}

            <div className="border-t border-dashed border-black my-2" />
            <p className="text-center text-sm font-black">Thank you for your purchase!</p>
            <p className="text-center text-[10px] text-neutral-500 mt-1">Powered by Fast Calories</p>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="gap-1.5">
            <X className="w-4 h-4" /> Close
          </Button>
          <Button variant="outline" onClick={handleBrowserPrint} className="gap-1.5">
            <Share2 className="w-4 h-4" /> Print / Save PDF
          </Button>
          {hasPrinter && (
            <Button onClick={onPrint} className="gap-1.5">
              <Printer className="w-4 h-4" /> Thermal Printer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
