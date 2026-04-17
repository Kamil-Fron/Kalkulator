import { ScheduleRow, SimulationParams, SimulationResult } from './types';

function monthDiff(d1: Date, d2: Date): number {
  let y = d2.getFullYear() - d1.getFullYear();
  let m = d2.getMonth() - d1.getMonth();
  return y * 12 + m + (d2.getDate() < d1.getDate() ? -1 : 0);
}

function getMonthlyInterestRate(month: number, ranges: SimulationParams['interestRanges']): number {
  let foundRate = 0;
  let lastRate = 0;
  let matched = false;

  for (const r of ranges) {
    if (r.rate) {
      lastRate = r.rate;
    }
    if (month >= r.startMonth && month <= r.endMonth) {
      foundRate = r.rate;
      matched = true;
    }
  }

  if (!matched && lastRate > 0) {
    foundRate = lastRate;
  }
  return foundRate / 100 / 12;
}

export function simulateSchedule(
  params: SimulationParams,
  overrideMonthlyOverpayment: number | null = null,
  overrideYearlyOverpayment: number | null = null,
  ignoreRefinance: boolean = false,
  ignoreOverpaymentsData: boolean = false
): SimulationResult {
  const {
    loanAmount: loanAmountTotal,
    termMonths: plannedMonths,
    startDate: startDateStr,
    gracePeriodMonths: gracePeriod,
    rateType,
    firstMonthExtraAmount,
    interestRanges,
    transzes,
    overpayment,
    refinance,
    inflationRate,
  } = params;

  if (loanAmountTotal <= 0 || !startDateStr) {
    return {
      schedule: [],
      totalPaid: 0,
      totalInterest: 0,
      totalOverpayments: 0,
      months: 0,
      totalLoanAmount: 0,
    };
  }

  const startDate = new Date(startDateStr);
  const localTransze = transzes.map((t) => ({ ...t, date: new Date(t.date), added: false }));
  if (localTransze.length === 0) {
    localTransze.push({ date: startDate, amount: loanAmountTotal, added: false });
  }

  localTransze.sort((a, b) => a.date.getTime() - b.date.getTime());

  let schedule: ScheduleRow[] = [];
  let balance = 0;
  let totalPaid = 0;
  let totalOverpayments = 0;
  let totalInterest = 0;
  let currentDate = new Date(startDate);
  currentDate.setMonth(currentDate.getMonth() + 1);

  let m = 1;
  const maxSafety = plannedMonths + 400; // infinite loop protection
  let currentPlannedMonths = plannedMonths;

  let refinActive = ignoreRefinance ? false : refinance.active;

  while (m < maxSafety) {
    let addedBefore = 0;
    localTransze.forEach((t) => {
      if (!t.added && t.date <= currentDate) {
        balance += t.amount;
        t.added = true;
        addedBefore += t.amount;
      }
    });

    if (balance < 0.01 && localTransze.every((t) => t.added)) {
      break;
    }

    let rateYearly = 0;
    if (refinActive && m >= refinance.month) {
      rateYearly = refinance.newRate;
      if (m === refinance.month && refinance.newTermMonths > 0) {
        currentPlannedMonths = refinance.month + refinance.newTermMonths - 1;
      }
    } else {
      rateYearly = getMonthlyInterestRate(m, interestRanges) * 12 * 100;
    }

    const monthlyRate = rateYearly / 100 / 12;
    let interest = balance * monthlyRate;
    let capitalPart = 0;
    let installment = 0;
    let monthsRemaining = currentPlannedMonths - m + 1;
    if (monthsRemaining < 1) monthsRemaining = 1;

    if (m <= gracePeriod) {
      installment = interest;
      capitalPart = 0;
    } else {
      if (rateType === 'rowne') {
        if (monthlyRate === 0) installment = balance / monthsRemaining;
        else installment = (balance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -monthsRemaining));
        capitalPart = installment - interest;
      } else {
        capitalPart = balance / monthsRemaining;
        installment = capitalPart + interest;
      }
    }

    if (capitalPart < 0) capitalPart = 0;

    let manualOver = 0;
    if (!ignoreOverpaymentsData) {
        // Evaluate cyclic and custom
        if (overpayment.customData && overpayment.customData[m]) {
            manualOver += overpayment.customData[m];
        } else if (overpayment.intervalMonths > 0 && overpayment.amount > 0 && overpayment.startDate) {
            const startOverDate = new Date(overpayment.startDate);
            const offset = monthDiff(startDate, startOverDate);
            if (m > offset && (m - offset - 1) % overpayment.intervalMonths === 0) {
                manualOver += overpayment.amount;
            }
        }
    }

    if (overrideMonthlyOverpayment !== null) {
      manualOver += overrideMonthlyOverpayment;
    }
    if (overrideYearlyOverpayment !== null && m % 12 === 0) {
      manualOver += overrideYearlyOverpayment;
    }

    let suggestedOver = 0;
    if (!ignoreOverpaymentsData) {
      let canUseDeclared = true;
      const targetStart = overpayment.targetStartDate ? new Date(overpayment.targetStartDate) : null;
      if (targetStart && currentDate < targetStart) canUseDeclared = false;

      if (canUseDeclared && overpayment.targetInstallment > 0 && installment < overpayment.targetInstallment) {
        suggestedOver = overpayment.targetInstallment - installment;
      }
    }

    if (m === 1) {
        manualOver += firstMonthExtraAmount;
    }

    let totalOver = manualOver + suggestedOver;
    let capitalToReduce = capitalPart + totalOver;

    if (capitalToReduce > balance) {
      capitalToReduce = balance;
    }

    let realPayment = interest + capitalToReduce;

    let addedAfter = 0;
    let nextPaymentDate = new Date(currentDate);
    nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
    localTransze.forEach((t) => {
      if (!t.added && t.date > currentDate && t.date < nextPaymentDate) {
        balance += t.amount;
        t.added = true;
        addedAfter += t.amount;
      }
    });

    // Calculate real value based on inflation
    // Value = Payment / ((1 + (inflationRate/100/12))^m)
    const monthlyInflation = inflationRate / 100 / 12;
    const realValueInstallment = realPayment / Math.pow(1 + monthlyInflation, m);

    schedule.push({
      id: m,
      date: new Date(currentDate).toISOString(),
      installment: realPayment,
      capital: capitalToReduce - totalOver,
      interest: interest,
      overpayment: totalOver,
      balance: balance - capitalToReduce,
      realValueInstallment,
    });

    balance -= capitalToReduce;
    totalPaid += realPayment;
    totalInterest += interest;
    totalOverpayments += totalOver;
    m++;
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  const loanAmt = localTransze.reduce((a, b) => a + b.amount, 0);

  return {
    schedule,
    totalPaid,
    totalInterest,
    totalOverpayments,
    months: schedule.length,
    totalLoanAmount: loanAmt,
  };
}
