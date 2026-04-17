export const defaultParams = {
  loanAmount: 409000,
  termMonths: 29 * 12,
  startDate: new Date().toISOString().split('T')[0],
  gracePeriodMonths: 18,
  rateType: 'rowne' as const,
  firstMonthExtraAmount: 0,
  interestRanges: [
    { startMonth: 1, endMonth: 60, rate: 7.04 },
    { startMonth: 61, endMonth: 500, rate: 7.44 },
  ],
  transzes: [
    { date: '2025-03-15', amount: 159000 },
    { date: '2025-04-30', amount: 66000 },
    { date: '2025-08-31', amount: 66000 },
    { date: '2025-12-31', amount: 33000 },
    { date: '2025-12-31', amount: 85000 },
  ],
  overpayment: {
    type: 'cyclic' as const,
    intervalMonths: 12,
    amount: 7000,
    startDate: '2026-03-15',
    customData: {},
    targetInstallment: 0,
    targetStartDate: '',
  },
  refinance: {
    active: false,
    month: 60,
    newRate: 5.5,
    newTermMonths: 0,
  },
  inflationRate: 2.5, // 2.5% inflation parameter
};
