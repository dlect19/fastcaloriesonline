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
    const w = window.open('', '_blank', 'width=400,height=700');
    if (!w) return;
    const html = `
<!doctype html><html><head><meta charset="utf-8"><title>${receipt.receiptNumber}</title>
<style>
  body{font-family:'Courier New',monospace;font-size:12px;width:280px;margin:0 auto;padding:10px;color:#000}
  h2{text-align:center;margin:4px 0;font-size:14px}
  .center{text-align:center}
  .row{display:flex;justify-content:space-between}
  .sep{border-top:1px dashed #000;margin:6px 0}
  .b{font-weight:bold}
</style></head><body>
  ${receipt.storeLogoUrl ? `<div class="center"><img src="${receipt.storeLogoUrl}" style="max-width:80px;max-height:60px"/></div>` : ''}
  <h2>${receipt.storeName}</h2>
  ${receipt.storeAddress ? `<div class="center">${receipt.storeAddress}</div>` : ''}
  ${receipt.storePhone ? `<div class="center">Tel: ${receipt.storePhone}</div>` : ''}
  <div class="sep"></div>
  <div class="row"><span>Receipt:</span><span class="b">${receipt.receiptNumber}</span></div>
  <div class="row"><span>Date:</span><span>${receipt.date.toLocaleString()}</span></div>
  ${receipt.cashierName ? `<div class="row"><span>Cashier:</span><span>${receipt.cashierName}</span></div>` : ''}
  ${receipt.customerName ? `<div class="row"><span>Customer:</span><span>${receipt.customerName}</span></div>` : ''}
  ${receipt.customerPhone ? `<div class="row"><span>Phone:</span><span>${receipt.customerPhone}</span></div>` : ''}
  <div class="sep"></div>
  ${receipt.items.map(it => `
    <div class="row"><span>${it.qty} x ${it.name}</span><span>NGN ${it.price.toLocaleString()}</span></div>
    ${it.calories ? `<div style="font-size:10px;color:#555">${it.calories * it.qty} kcal</div>` : ''}
  `).join('')}
  <div class="sep"></div>
  <div class="row b"><span>TOTAL</span><span>NGN ${receipt.total.toLocaleString()}</span></div>
  <div class="row"><span>Paid (${receipt.paymentMethod}):</span><span>NGN ${receipt.amountPaid.toLocaleString()}</span></div>
  ${receipt.change > 0 ? `<div class="row"><span>Change:</span><span>NGN ${receipt.change.toLocaleString()}</span></div>` : ''}
  ${receipt.totalCalories ? `<div class="sep"></div><div class="center">Total: ${receipt.totalCalories} kcal</div>` : ''}
  <div class="sep"></div>
  <div class="center">Thank you for your purchase!</div>
  <div class="center" style="font-size:10px;margin-top:8px">Powered by Fast Calories</div>
  <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500)}</script>
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
          <div className="mx-auto bg-card border rounded-lg p-4 font-mono text-xs leading-relaxed" style={{ maxWidth: 280 }}>
            {receipt.storeLogoUrl && (
              <div className="flex justify-center mb-2">
                <img src={receipt.storeLogoUrl} alt="" className="max-h-12" />
              </div>
            )}
            <p className="text-center font-bold text-sm">{receipt.storeName}</p>
            {receipt.storeAddress && <p className="text-center text-[10px]">{receipt.storeAddress}</p>}
            {receipt.storePhone && <p className="text-center text-[10px]">Tel: {receipt.storePhone}</p>}

            <div className="border-t border-dashed my-2" />

            <div className="flex justify-between"><span>Receipt:</span><span className="font-bold">{receipt.receiptNumber}</span></div>
            <div className="flex justify-between"><span>Date:</span><span>{receipt.date.toLocaleString()}</span></div>
            {receipt.cashierName && <div className="flex justify-between"><span>Cashier:</span><span>{receipt.cashierName}</span></div>}
            {receipt.customerName && <div className="flex justify-between"><span>Customer:</span><span>{receipt.customerName}</span></div>}
            {receipt.customerPhone && <div className="flex justify-between"><span>Phone:</span><span>{receipt.customerPhone}</span></div>}

            <div className="border-t border-dashed my-2" />

            {receipt.items.map((it, i) => (
              <div key={i} className="mb-1">
                <div className="flex justify-between">
                  <span className="truncate pr-2">{it.qty} × {it.name}</span>
                  <span>₦{it.price.toLocaleString()}</span>
                </div>
                {it.calories ? <p className="text-[10px] text-muted-foreground">{it.calories * it.qty} kcal</p> : null}
              </div>
            ))}

            <div className="border-t border-dashed my-2" />

            <div className="flex justify-between font-bold text-sm">
              <span>TOTAL</span><span>₦{receipt.total.toLocaleString()}</span>
            </div>
            <div className="flex justify-between"><span>Paid ({receipt.paymentMethod}):</span><span>₦{receipt.amountPaid.toLocaleString()}</span></div>
            {receipt.change > 0 && (
              <div className="flex justify-between"><span>Change:</span><span>₦{receipt.change.toLocaleString()}</span></div>
            )}

            {receipt.totalCalories ? (
              <>
                <div className="border-t border-dashed my-2" />
                <p className="text-center">Total: {receipt.totalCalories} kcal</p>
              </>
            ) : null}

            <div className="border-t border-dashed my-2" />
            <p className="text-center">Thank you for your purchase!</p>
            <p className="text-center text-[10px] text-muted-foreground mt-2">Powered by Fast Calories</p>
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
