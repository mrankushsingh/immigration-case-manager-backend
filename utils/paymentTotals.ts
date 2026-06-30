export function isFeePaymentEntry(payment: { entryType?: string; method?: string }): boolean {
  if (payment.entryType === 'fee') return true;
  if (payment.entryType === 'payment') return false;
  const method = (payment.method || '').trim().toLowerCase();
  return method === 'honorario' || method === 'honorarios' || method.startsWith('honorario ')
    || method === 'additional fee' || method === 'service fee' || method.startsWith('service ');
}

export function isServiceFeeEntry(payment: { entryType?: string; method?: string }): boolean {
  if (!isFeePaymentEntry(payment)) return false;
  const method = (payment.method || '').trim().toLowerCase();
  return method === 'service fee' || method.startsWith('service ') || method === 'additional fee';
}

export function sumServiceFeeAmount(payments: Array<{ amount?: number; entryType?: string; method?: string }> | undefined): number {
  return (payments || []).reduce(
    (sum, payment) => (isServiceFeeEntry(payment) ? sum + (Number(payment.amount) || 0) : sum),
    0
  );
}

export function sumPaidPaymentAmount(payments: Array<{ amount?: number; entryType?: string; method?: string }> | undefined): number {
  return (payments || []).reduce((sum, payment) => {
    if (isFeePaymentEntry(payment)) return sum;
    return sum + (Number(payment.amount) || 0);
  }, 0);
}
