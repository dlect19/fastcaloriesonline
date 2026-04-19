/**
 * ESC/POS thermal printer utility (Web Bluetooth)
 *
 * Compatible with most 58mm/80mm Bluetooth thermal POS printers
 * (Goojprt, Xprinter, MUNBYN, Epson TM-Pxxx, etc.).
 *
 * Usage:
 *   const printer = await EscPosPrinter.connect();
 *   await printer.printReceipt({...});
 */

// ESC/POS commands
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const CMD = {
  INIT: new Uint8Array([ESC, 0x40]),
  ALIGN_LEFT: new Uint8Array([ESC, 0x61, 0]),
  ALIGN_CENTER: new Uint8Array([ESC, 0x61, 1]),
  ALIGN_RIGHT: new Uint8Array([ESC, 0x61, 2]),
  BOLD_ON: new Uint8Array([ESC, 0x45, 1]),
  BOLD_OFF: new Uint8Array([ESC, 0x45, 0]),
  DOUBLE_SIZE: new Uint8Array([GS, 0x21, 0x11]),
  NORMAL_SIZE: new Uint8Array([GS, 0x21, 0x00]),
  CUT: new Uint8Array([GS, 0x56, 1]),
  FEED: (n: number) => new Uint8Array([ESC, 0x64, n]),
  LF: new Uint8Array([LF]),
};

export interface ReceiptItem {
  name: string;
  qty: number;
  price: number;
  note?: string;
}

export interface ReceiptData {
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  receiptNumber: string;
  cashierName?: string;
  date: Date;
  items: ReceiptItem[];
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
  paymentMethod: string;
  amountPaid?: number;
  change?: number;
  customerName?: string;
  customerPhone?: string;
  footer?: string;
  paperWidth?: 32 | 48; // chars (58mm = 32, 80mm = 48)
}

const PRINTER_SERVICE_UUIDS = [
  0x18f0, // Common ESC/POS service
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Some Goojprt
];

const WRITE_CHAR_UUIDS = [
  0x2af1,
  '00002af1-0000-1000-8000-00805f9b34fb',
  '49535343-8841-43f4-a8d4-ecbe34729bb3',
];

export class EscPosPrinter {
  private device: BluetoothDevice;
  private characteristic: BluetoothRemoteGATTCharacteristic;

  constructor(device: BluetoothDevice, characteristic: BluetoothRemoteGATTCharacteristic) {
    this.device = device;
    this.characteristic = characteristic;
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  static async connect(): Promise<EscPosPrinter> {
    if (!EscPosPrinter.isSupported()) {
      throw new Error('Web Bluetooth not supported on this device. Use Chrome on Android or desktop.');
    }

    const device = await (navigator as any).bluetooth.requestDevice({
      filters: [
        { services: [PRINTER_SERVICE_UUIDS[1]] },
        { services: [PRINTER_SERVICE_UUIDS[2]] },
        { namePrefix: 'Printer' },
        { namePrefix: 'POS' },
        { namePrefix: 'BT' },
        { namePrefix: 'MTP' },
        { namePrefix: 'MPT' },
        { namePrefix: 'RPP' },
        { namePrefix: 'Goojprt' },
        { namePrefix: 'Xprinter' },
      ],
      optionalServices: PRINTER_SERVICE_UUIDS,
    });

    if (!device.gatt) throw new Error('Bluetooth GATT not available on selected device.');

    const server = await device.gatt.connect();

    let characteristic: BluetoothRemoteGATTCharacteristic | null = null;
    for (const serviceUuid of PRINTER_SERVICE_UUIDS) {
      try {
        const service = await server.getPrimaryService(serviceUuid as any);
        for (const charUuid of WRITE_CHAR_UUIDS) {
          try {
            const char = await service.getCharacteristic(charUuid as any);
            if (char.properties.write || char.properties.writeWithoutResponse) {
              characteristic = char;
              break;
            }
          } catch {
            // try next
          }
        }
        if (characteristic) break;
      } catch {
        // try next service
      }
    }

    if (!characteristic) {
      try {
        const services = await server.getPrimaryServices();
        for (const svc of services) {
          const chars = await svc.getCharacteristics();
          const w = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (w) {
            characteristic = w;
            break;
          }
        }
      } catch {
        // ignore
      }
    }

    if (!characteristic) {
      throw new Error('Could not find a writable printer characteristic. Make sure the printer is on and in range.');
    }

    return new EscPosPrinter(device, characteristic);
  }

  get name(): string {
    return this.device.name || 'Bluetooth Printer';
  }

  get id(): string {
    return this.device.id;
  }

  private async write(data: Uint8Array): Promise<void> {
    // Some printers fail on big writes; chunk to 100 bytes.
    const CHUNK = 100;
    for (let i = 0; i < data.length; i += CHUNK) {
      const slice = data.slice(i, i + CHUNK);
      try {
        await this.characteristic.writeValueWithoutResponse(slice);
      } catch {
        await this.characteristic.writeValue(slice);
      }
    }
  }

  private text(s: string): Uint8Array {
    return new TextEncoder().encode(s);
  }

  private concat(...arrs: Uint8Array[]): Uint8Array {
    const total = arrs.reduce((sum, a) => sum + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrs) {
      out.set(a, off);
      off += a.length;
    }
    return out;
  }

  private padLine(left: string, right: string, width: number): string {
    const space = Math.max(1, width - left.length - right.length);
    return left + ' '.repeat(space) + right;
  }

  private wrapName(name: string, max: number): string[] {
    if (name.length <= max) return [name];
    const lines: string[] = [];
    for (let i = 0; i < name.length; i += max) lines.push(name.slice(i, i + max));
    return lines;
  }

  async printReceipt(data: ReceiptData): Promise<void> {
    const width = data.paperWidth ?? 32;

    const parts: Uint8Array[] = [
      CMD.INIT,
      CMD.ALIGN_CENTER,
      CMD.BOLD_ON,
      CMD.DOUBLE_SIZE,
      this.text(data.storeName + '\n'),
      CMD.NORMAL_SIZE,
      CMD.BOLD_OFF,
    ];

    if (data.storeAddress) parts.push(this.text(data.storeAddress + '\n'));
    if (data.storePhone) parts.push(this.text(data.storePhone + '\n'));
    parts.push(this.text('-'.repeat(width) + '\n'));

    parts.push(CMD.ALIGN_LEFT);
    parts.push(this.text(`Receipt: ${data.receiptNumber}\n`));
    parts.push(this.text(`Date: ${data.date.toLocaleString()}\n`));
    if (data.cashierName) parts.push(this.text(`Cashier: ${data.cashierName}\n`));
    if (data.customerName) parts.push(this.text(`Customer: ${data.customerName}\n`));
    if (data.customerPhone) parts.push(this.text(`Phone: ${data.customerPhone}\n`));
    parts.push(this.text('-'.repeat(width) + '\n'));

    // Items
    for (const item of data.items) {
      const nameLines = this.wrapName(item.name, width);
      parts.push(this.text(nameLines[0] + '\n'));
      for (let i = 1; i < nameLines.length; i++) parts.push(this.text(nameLines[i] + '\n'));
      const lineRight = `N${item.price.toFixed(2)}`;
      const lineLeft = `  ${item.qty} x N${(item.price / Math.max(item.qty, 1)).toFixed(2)}`;
      parts.push(this.text(this.padLine(lineLeft, lineRight, width) + '\n'));
      if (item.note) parts.push(this.text(`  ${item.note}\n`));
    }

    parts.push(this.text('-'.repeat(width) + '\n'));
    parts.push(this.text(this.padLine('Subtotal', `N${data.subtotal.toFixed(2)}`, width) + '\n'));
    if (data.discount && data.discount > 0) {
      parts.push(this.text(this.padLine('Discount', `-N${data.discount.toFixed(2)}`, width) + '\n'));
    }
    if (data.tax && data.tax > 0) {
      parts.push(this.text(this.padLine('Tax', `N${data.tax.toFixed(2)}`, width) + '\n'));
    }

    parts.push(CMD.BOLD_ON);
    parts.push(this.text(this.padLine('TOTAL', `N${data.total.toFixed(2)}`, width) + '\n'));
    parts.push(CMD.BOLD_OFF);
    parts.push(this.text(this.padLine('Paid via', data.paymentMethod, width) + '\n'));
    if (data.amountPaid !== undefined) {
      parts.push(this.text(this.padLine('Amount Paid', `N${data.amountPaid.toFixed(2)}`, width) + '\n'));
    }
    if (data.change !== undefined && data.change > 0) {
      parts.push(this.text(this.padLine('Change', `N${data.change.toFixed(2)}`, width) + '\n'));
    }

    parts.push(this.text('-'.repeat(width) + '\n'));
    parts.push(CMD.ALIGN_CENTER);
    parts.push(this.text((data.footer ?? 'Thank you for your purchase!') + '\n'));
    parts.push(this.text('Powered by Fast Calories\n'));
    parts.push(CMD.FEED(3));
    parts.push(CMD.CUT);

    await this.write(this.concat(...parts));
  }

  disconnect(): void {
    if (this.device.gatt?.connected) this.device.gatt.disconnect();
  }
}

export type { ReceiptData as PosReceiptData };
