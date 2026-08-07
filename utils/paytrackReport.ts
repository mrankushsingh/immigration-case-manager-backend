import PDFDocument from 'pdfkit';
import { isFeePaymentEntry, sumPaidPaymentAmount } from './paymentTotals.js';

export type PaytrackReportPeriod = 'daily' | 'monthly' | 'all';

type PaymentLike = {
  amount?: number;
  date?: string;
  method?: string;
  note?: string;
  entryType?: string;
};

type HistoryLike = {
  at?: string;
  action?: string;
  detail?: string;
};

type ClientLike = {
  id: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  payment?: {
    totalFee?: number;
    paidAmount?: number;
    payments?: PaymentLike[];
    history?: HistoryLike[];
  };
};

export type PaytrackReportRange = {
  period: PaytrackReportPeriod;
  start: Date | null;
  end: Date | null;
  label: string;
};

export type PaytrackClientReportRow = {
  clientId: string;
  clientName: string;
  phone: string;
  totalFee: number;
  paidAmount: number;
  pending: number;
  periodPayments: PaymentLike[];
  periodFees: PaymentLike[];
  periodPaidTotal: number;
  periodFeeTotal: number;
  periodHistory: HistoryLike[];
};

export type PaytrackReport = {
  range: PaytrackReportRange;
  generatedAt: Date;
  clients: PaytrackClientReportRow[];
  totals: {
    clientCount: number;
    totalFee: number;
    totalPaid: number;
    totalPending: number;
    periodPaidTotal: number;
    periodFeeTotal: number;
  };
};

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function formatRangeDate(d: Date): string {
  return d.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatRangeTime(d: Date): string {
  return d.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseEntryTime(iso: string | undefined): number | null {
  if (!iso) return null;
  const trimmed = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
  }
  const t = new Date(trimmed).getTime();
  return Number.isNaN(t) ? null : t;
}

export function getPaytrackReportRange(
  period: PaytrackReportPeriod,
  now: Date = new Date()
): PaytrackReportRange {
  if (period === 'daily') {
    const end = new Date(now);
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return {
      period,
      start,
      end,
      label: `Daily · last 24 hours (${formatRangeDate(start)} ${formatRangeTime(start)} – ${formatRangeDate(end)} ${formatRangeTime(end)})`,
    };
  }

  if (period === 'monthly') {
    const start = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1));
    const end = endOfLocalDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    return {
      period,
      start,
      end,
      label: `Monthly · ${start.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}`,
    };
  }

  return {
    period: 'all',
    start: null,
    end: null,
    label: 'All · Full history',
  };
}

function inRange(iso: string | undefined, start: Date | null, end: Date | null): boolean {
  const t = parseEntryTime(iso);
  if (t == null) return false;
  if (!start || !end) return true;
  return t >= start.getTime() && t <= end.getTime();
}

function clientName(client: ClientLike): string {
  return `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Unnamed client';
}

function rowHasPeriodActivity(row: PaytrackClientReportRow): boolean {
  return (
    row.periodPayments.length > 0 ||
    row.periodFees.length > 0 ||
    row.periodHistory.length > 0
  );
}

export function buildPaytrackReport(
  clients: ClientLike[],
  period: PaytrackReportPeriod,
  now: Date = new Date()
): PaytrackReport {
  const range = getPaytrackReportRange(period, now);

  let rows: PaytrackClientReportRow[] = [...clients]
    .sort((a, b) => clientName(a).localeCompare(clientName(b)))
    .map((client) => {
      const payments = client.payment?.payments || [];
      const totalFee = Number(client.payment?.totalFee) || 0;
      const paidAmount = payments.length
        ? sumPaidPaymentAmount(payments)
        : Number(client.payment?.paidAmount) || 0;
      const pending = totalFee - paidAmount;

      const periodPayments = payments.filter(
        (p) => !isFeePaymentEntry(p) && inRange(p.date, range.start, range.end)
      );
      const periodFees = payments.filter(
        (p) => isFeePaymentEntry(p) && inRange(p.date, range.start, range.end)
      );
      const periodHistory = (client.payment?.history || []).filter((h) =>
        inRange(h.at, range.start, range.end)
      );

      return {
        clientId: client.id,
        clientName: clientName(client),
        phone: client.phone || '',
        totalFee,
        paidAmount,
        pending,
        periodPayments,
        periodFees,
        periodPaidTotal: sumPaidPaymentAmount(periodPayments),
        periodFeeTotal: periodFees.reduce((s, p) => s + (Number(p.amount) || 0), 0),
        periodHistory,
      };
    });

  if (period !== 'all') {
    rows = rows.filter(rowHasPeriodActivity);
  }

  const totals = rows.reduce(
    (acc, row) => {
      acc.totalFee += row.totalFee;
      acc.totalPaid += row.paidAmount;
      acc.totalPending += Math.max(0, row.pending);
      acc.periodPaidTotal += row.periodPaidTotal;
      acc.periodFeeTotal += row.periodFeeTotal;
      return acc;
    },
    {
      clientCount: rows.length,
      totalFee: 0,
      totalPaid: 0,
      totalPending: 0,
      periodPaidTotal: 0,
      periodFeeTotal: 0,
    }
  );

  return { range, generatedAt: now, clients: rows, totals };
}

function money(n: number): string {
  return `EUR ${(Number(n) || 0).toFixed(2)}`;
}

function formatEntryDate(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function paytrackReportSummaryText(report: PaytrackReport): string {
  const period = report.range.period;
  const lines = [
    'PayTrack report',
    report.range.label,
    `Generated: ${report.generatedAt.toLocaleString('es-ES')}`,
    '',
    `Clients in report: ${report.totals.clientCount}${period === 'all' ? '' : ' with activity'}`,
    `Period paid: ${money(report.totals.periodPaidTotal)}`,
    `Period fees: ${money(report.totals.periodFeeTotal)}`,
    `Current pending (listed clients): ${money(report.totals.totalPending)}`,
  ];

  if (report.clients.length === 0) {
    lines.push('', period === 'daily'
      ? 'No client activity in the last 24 hours.'
      : period === 'monthly'
        ? 'No client activity this month.'
        : 'No PayTrack clients.');
  } else {
    lines.push('', 'Top activity:');
    for (const row of report.clients.slice(0, 8)) {
      lines.push(
        `• ${row.clientName}: paid ${money(row.periodPaidTotal)}, fees ${money(row.periodFeeTotal)}`
      );
    }
    if (report.clients.length > 8) {
      lines.push(`… and ${report.clients.length - 8} more (see PDF)`);
    }
  }

  return lines.join('\n');
}

export async function paytrackReportToPdfBuffer(report: PaytrackReport): Promise<Buffer> {
  const period = report.range.period;
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks: Buffer[] = [];

  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(20).text('PayTrack Report', { underline: false });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor('#555555').text(report.range.label);
  doc.text(`Generated ${report.generatedAt.toLocaleString('es-ES')}`);
  doc.text(
    `${report.totals.clientCount} client${report.totals.clientCount === 1 ? '' : 's'}${
      period === 'all' ? '' : ' with activity'
    }`
  );
  doc.fillColor('#000000');
  doc.moveDown();

  doc.fontSize(11).text(`Clients in report: ${report.totals.clientCount}`);
  doc.text(`Current total fees: ${money(report.totals.totalFee)}`);
  doc.text(`Current total paid: ${money(report.totals.totalPaid)}`);
  doc.text(`Current pending: ${money(report.totals.totalPending)}`);
  doc.text(
    `${period === 'all' ? 'All paid entries' : 'Paid in period'}: ${money(report.totals.periodPaidTotal)}`
  );
  doc.text(
    `${period === 'all' ? 'All fee entries' : 'Fees in period'}: ${money(report.totals.periodFeeTotal)}`
  );
  doc.moveDown();

  if (report.clients.length === 0) {
    doc.fontSize(11).fillColor('#888888').text(
      period === 'daily'
        ? 'No client activity in the last 24 hours.'
        : period === 'monthly'
          ? 'No client activity this month.'
          : 'No PayTrack clients.'
    );
  }

  for (const row of report.clients) {
    doc.addPage();
    doc.fillColor('#000000').fontSize(14).text(row.clientName);
    doc.fontSize(10).fillColor('#666666').text(row.phone || 'No phone');
    doc.fillColor('#000000');
    doc.moveDown(0.4);
    doc.fontSize(10);
    doc.text(`Current honorarios / Total fee: ${money(row.totalFee)}`);
    doc.text(`Current paid: ${money(row.paidAmount)}`);
    doc.text(`Current pending: ${money(Math.max(0, row.pending))}`);
    doc.text(
      `${period === 'all' ? 'Total paid (all)' : 'Paid in this period'}: ${money(row.periodPaidTotal)}`
    );
    doc.text(
      `${period === 'all' ? 'Total fees (all)' : 'Fees in this period'}: ${money(row.periodFeeTotal)}`
    );
    doc.moveDown(0.5);

    doc.fontSize(11).text(
      period === 'daily'
        ? 'Activity (last 24 hours)'
        : period === 'monthly'
          ? 'Activity (this month)'
          : 'Full activity history'
    );
    doc.fontSize(9);
    const activity = [
      ...row.periodPayments.map(
        (p) =>
          `Payment ${money(Number(p.amount) || 0)} · ${formatEntryDate(p.date)} · ${p.method || 'Payment'}${
            p.note ? ` · ${p.note}` : ''
          }`
      ),
      ...row.periodFees.map(
        (p) =>
          `Fee +${money(Number(p.amount) || 0)} · ${formatEntryDate(p.date)} · ${p.method || 'Fee'}${
            p.note ? ` · ${p.note}` : ''
          }`
      ),
    ];
    if (activity.length === 0) {
      doc.fillColor('#888888').text('No payments or fees in this period.');
      doc.fillColor('#000000');
    } else {
      for (const line of activity) {
        doc.text(`• ${line}`, { width: 500 });
      }
    }

    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#000000').text(
      period === 'daily'
        ? 'Audit (last 24 hours)'
        : period === 'monthly'
          ? 'Audit (this month)'
          : 'Full audit history'
    );
    doc.fontSize(9);
    if (row.periodHistory.length === 0) {
      doc.fillColor('#888888').text('No audit events in this period.');
      doc.fillColor('#000000');
    } else {
      for (const h of row.periodHistory) {
        doc.text(
          `• ${formatEntryDate(h.at)} · ${h.action || ''} · ${h.detail || ''}`,
          { width: 500 }
        );
      }
    }
  }

  doc.end();
  return done;
}

export function paytrackReportFilename(report: PaytrackReport): string {
  const stamp = report.generatedAt.toISOString().slice(0, 10);
  return `paytrack-${report.range.period}-${stamp}.pdf`;
}
