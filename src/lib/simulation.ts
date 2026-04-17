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
      totalAdditionalCosts: 0,
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
  let totalAdditionalCosts = 0;
  let currentDate = new Date(startDate);
  currentDate.setMonth(currentDate.getMonth() + 1);

  let m = 1;
  const maxSafety = plannedMonths + 400; // infinite loop protection
  let currentPlannedMonths = plannedMonths;

  let refinActive = ignoreRefinance ? false : refinance.active;

  while (m < maxSafety) {
    let prevDate = new Date(startDate);
    prevDate.setMonth(prevDate.getMonth() + m - 1);

    let events: { type: 'tranche' | 'overpayment', date: Date, amount: number }[] = [];

    localTransze.forEach((t) => {
      if (!t.added) {
        if (m === 1 && t.date <= currentDate) {
          let evDate = t.date < prevDate ? prevDate : t.date;
          events.push({ type: 'tranche', date: new Date(evDate), amount: t.amount });
          t.added = true;
        } else if (m > 1 && t.date > prevDate && t.date <= currentDate) {
          events.push({ type: 'tranche', date: new Date(t.date), amount: t.amount });
          t.added = true;
        }
      }
    });

    let oneTimeNominalThisMonth = 0;
    if (m === 1 && firstMonthExtraAmount > 0) {
        events.push({ type: 'overpayment', date: new Date(startDate), amount: firstMonthExtraAmount });
        oneTimeNominalThisMonth += firstMonthExtraAmount;
    }

    if (!ignoreOverpaymentsData && params.oneTimeOverpayments) {
      params.oneTimeOverpayments.forEach(ot => {
        if (ot.amount > 0 && ot.date) {
          const otDate = new Date(ot.date);
          if (m === 1 && otDate <= currentDate) {
            let evDate = otDate < prevDate ? prevDate : otDate;
            events.push({ type: 'overpayment', date: new Date(evDate), amount: ot.amount });
            oneTimeNominalThisMonth += ot.amount;
          } else if (m > 1 && otDate > prevDate && otDate <= currentDate) {
            events.push({ type: 'overpayment', date: new Date(otDate), amount: ot.amount });
            oneTimeNominalThisMonth += ot.amount;
          }
        }
      });
    }

    events.sort((a, b) => a.date.getTime() - b.date.getTime());

    let theoreticalBalance = balance;
    events.forEach(ev => {
      if (ev.type === 'tranche') theoreticalBalance += ev.amount;
    });

    const hasFutureTranches = localTransze.some(t => !t.added);
    if (theoreticalBalance < 0.01 && !hasFutureTranches) {
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

    let tempBalance = balance;
    let accumulatedInterest = 0;
    let unpaidInterest = 0;
    let lastEventFraction = 0;

    const msDiff = currentDate.getTime() - prevDate.getTime();

    events.forEach(ev => {
       let fraction = msDiff > 0 ? (ev.date.getTime() - prevDate.getTime()) / msDiff : 1;
       if (fraction < 0) fraction = 0;
       if (fraction > 1) fraction = 1;

       let duration = fraction - lastEventFraction;
       let accrued = tempBalance * monthlyRate * duration;
       
       accumulatedInterest += accrued;
       unpaidInterest += accrued;
       lastEventFraction = fraction;

       if (ev.type === 'tranche') {
           tempBalance += ev.amount;
       } else if (ev.type === 'overpayment') {
           let toInterest = Math.min(unpaidInterest, ev.amount);
           unpaidInterest -= toInterest;
           let toCapital = ev.amount - toInterest;
           tempBalance -= toCapital;
       }
    });

    let remainingDuration = 1 - lastEventFraction;
    let accrued = tempBalance * monthlyRate * remainingDuration;
    accumulatedInterest += accrued;
    unpaidInterest += accrued;

    let interest = accumulatedInterest;

    let capitalPart = 0;
    let installment = 0;
    let monthsRemaining = currentPlannedMonths - m + 1;
    if (monthsRemaining < 1) monthsRemaining = 1;

    if (m <= gracePeriod) {
      installment = interest;
      capitalPart = 0;
    } else {
      if (rateType === 'rowne') {
        if (monthlyRate === 0) installment = theoreticalBalance / monthsRemaining;
        else installment = (theoreticalBalance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -monthsRemaining));
        capitalPart = installment - interest;
      } else {
        capitalPart = theoreticalBalance / monthsRemaining;
        installment = capitalPart + interest;
      }
    }

    if (capitalPart < 0) capitalPart = 0;
    
    balance = theoreticalBalance;

    let manualOver = oneTimeNominalThisMonth;

    if (!ignoreOverpaymentsData) {
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

    let additionalCostThisMonth = 0;
    if (m === 1) {
      additionalCostThisMonth += (params.additionalCosts?.initialFee || 0);
      additionalCostThisMonth += (params.additionalCosts?.insuranceFirstYear || 0);
    } else if (params.additionalCosts?.insuranceMonthly > 0 && params.additionalCosts?.insuranceEndDate) {
      const insEndDate = new Date(params.additionalCosts.insuranceEndDate);
      if (currentDate <= insEndDate) {
        additionalCostThisMonth += params.additionalCosts.insuranceMonthly;
      }
    }

    let totalOver = manualOver + suggestedOver;
    let capitalToReduce = capitalPart + totalOver;

    if (capitalToReduce > balance) {
      capitalToReduce = balance;
    }

    let realPayment = interest + capitalToReduce + additionalCostThisMonth;

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
      additionalCost: additionalCostThisMonth,
      balance: balance - capitalToReduce,
      realValueInstallment,
    });

    balance -= capitalToReduce;
    totalPaid += realPayment;
    totalInterest += interest;
    totalOverpayments += totalOver;
    totalAdditionalCosts += additionalCostThisMonth;
    m++;
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  const loanAmt = localTransze.reduce((a, b) => a + b.amount, 0);

  return {
    schedule,
    totalPaid,
    totalInterest,
    totalOverpayments,
    totalAdditionalCosts,
    months: schedule.length,
    totalLoanAmount: loanAmt,
  };
}
