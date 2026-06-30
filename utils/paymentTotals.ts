export function isFeePaymentEntry(payment: { entryType?: string; method?: string }): boolean {
  if (payment.entryType === 'fee') return true;
  if (payment.entryType === 'payment') return false;
  const method = (payment.method || '').trim().toLowerCase();
  return method === 'honorario' || method === 'additional fee' || method.startsWith('honorario ');
}

export function sumPaidPaymentAmount(payments: Array<{ amount?: number; entryType?: string; method?: string }> | undefined): number {
  return (payments || []).reduce((sum, payment) => {
    if (isFeePaymentEntry(payment)) return sum;
    return sum + (Number(payment.amount) || 0);
  }, 0);
}
