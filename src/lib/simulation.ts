import { ScheduleRow, SimulationParams, SimulationResult } from './types';

function monthDiff(d1: Date, d2: Date): number {
  let y = d2.getFullYear() - d1.getFullYear();
  let m = d2.getMonth() - d1.getMonth();
  return y * 12 + m + (d2.getDate() < d1.getDate() ? -1 : 0);
}

function getBusinessDay(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  if (day === 6) { // Saturday
    d.setDate(d.getDate() + 2);
  } else if (day === 0) { // Sunday
    d.setDate(d.getDate() + 1);
  }
  return d;
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

    let actualPrevDate = getBusinessDay(prevDate);
    let actualCurrentDate = getBusinessDay(currentDate);

    let events: { type: 'tranche' | 'overpayment' | 'initial_contribution', date: Date, amount: number }[] = [];

    localTransze.forEach((t) => {
      if (!t.added) {
        if (m === 1 && t.date <= actualCurrentDate) {
          let evDate = t.date < actualPrevDate ? actualPrevDate : t.date;
          events.push({ type: 'tranche', date: new Date(evDate), amount: t.amount });
          t.added = true;
        } else if (m > 1 && t.date > actualPrevDate && t.date <= actualCurrentDate) {
          events.push({ type: 'tranche', date: new Date(t.date), amount: t.amount });
          t.added = true;
        }
      }
    });

    let oneTimeNominalThisMonth = 0;
    if (m === 1 && firstMonthExtraAmount > 0) {
        events.push({ type: 'initial_contribution', date: new Date(actualPrevDate), amount: firstMonthExtraAmount });
    }

    if (!ignoreOverpaymentsData && params.oneTimeOverpayments) {
      params.oneTimeOverpayments.forEach(ot => {
        if (ot.amount > 0 && ot.date) {
          const otDate = new Date(ot.date);
          const businessOtDate = getBusinessDay(otDate);
          if (m === 1 && businessOtDate <= actualCurrentDate) {
            let evDate = businessOtDate < actualPrevDate ? actualPrevDate : businessOtDate;
            events.push({ type: 'overpayment', date: new Date(evDate), amount: ot.amount });
            oneTimeNominalThisMonth += ot.amount;
          } else if (m > 1 && businessOtDate > actualPrevDate && businessOtDate <= actualCurrentDate) {
            events.push({ type: 'overpayment', date: new Date(businessOtDate), amount: ot.amount });
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

    const monthlyRateForAnnuity = rateYearly / 100 / 12;

    let tempBalance = balance;
    let accumulatedInterest = 0;
    let unpaidInterest = 0;
    let overpaymentInterestPaid = 0;
    let overpaymentCapitalPaid = 0;

    let lastEventDate = new Date(actualPrevDate);

    const msDiff = actualCurrentDate.getTime() - actualPrevDate.getTime();

    const monthlyInflation = inflationRate / 100 / 12;

    events.forEach(ev => {
       let evMsDiff = ev.date.getTime() - lastEventDate.getTime();
       let days = evMsDiff > 0 ? Math.round(evMsDiff / 86400000) : 0;
       let accrued = tempBalance * (rateYearly / 100) / 365 * days;
       
       accumulatedInterest += accrued;
       unpaidInterest += accrued;
       lastEventDate = new Date(ev.date);

       if (ev.type === 'tranche') {
           tempBalance += ev.amount;
       } else if (ev.type === 'overpayment' || ev.type === 'initial_contribution') {
           let toInterest = Math.min(unpaidInterest, ev.amount);
           unpaidInterest -= toInterest;
           let toCapital = ev.amount - toInterest;
           tempBalance -= toCapital;

           schedule.push({
               id: ev.type === 'initial_contribution' ? 'Start' : `${m}N`,
               type: ev.type,
               date: new Date(ev.date).toISOString(),
               installment: 0,
               capital: toCapital,
               interest: toInterest,
               overpayment: ev.type === 'initial_contribution' ? 0 : ev.amount,
               additionalCost: 0,
               balance: tempBalance,
               realValueInstallment: ev.amount / Math.pow(1 + monthlyInflation, m)
           });
           
           totalPaid += ev.amount;
           totalInterest += toInterest;
           if (ev.type === 'overpayment') {
               totalOverpayments += ev.amount;
           }
       }
    });

    let remMsDiff = actualCurrentDate.getTime() - lastEventDate.getTime();
    let remDays = remMsDiff > 0 ? Math.round(remMsDiff / 86400000) : 0;
    let accrued = tempBalance * (rateYearly / 100) / 365 * remDays;
    
    accumulatedInterest += accrued;
    unpaidInterest += accrued;

    let interest = accumulatedInterest;

    let capitalPart = 0;
    let installment = 0;
    let monthsRemaining = currentPlannedMonths - m + 1;
    if (monthsRemaining < 1) monthsRemaining = 1;

    let theoreticalInterestFull = theoreticalBalance * monthlyRateForAnnuity;

    if (m <= gracePeriod) {
      capitalPart = 0;
      installment = unpaidInterest;
    } else {
      if (rateType === 'rowne') {
        if (monthlyRateForAnnuity === 0) {
            installment = theoreticalBalance / monthsRemaining;
        } else {
            installment = (theoreticalBalance * monthlyRateForAnnuity) / (1 - Math.pow(1 + monthlyRateForAnnuity, -monthsRemaining));
        }
        capitalPart = installment - theoreticalInterestFull;
        if (capitalPart < 0) capitalPart = 0;
        installment = capitalPart + unpaidInterest;
      } else {
        capitalPart = theoreticalBalance / monthsRemaining;
        installment = capitalPart + unpaidInterest;
      }
    }

    if (capitalPart < 0) capitalPart = 0;

    let monthEndOverpayment = 0;

    if (!ignoreOverpaymentsData) {
        if (overpayment.customData && overpayment.customData[m]) {
            monthEndOverpayment += overpayment.customData[m];
        } else if (overpayment.intervalMonths > 0 && overpayment.amount > 0 && overpayment.startDate) {
            const startOverDate = new Date(overpayment.startDate);
            const offset = monthDiff(startDate, startOverDate);
            if (m > offset && (m - offset - 1) % overpayment.intervalMonths === 0) {
                monthEndOverpayment += overpayment.amount;
            }
        }
    }

    if (overrideMonthlyOverpayment !== null) {
      monthEndOverpayment += overrideMonthlyOverpayment;
    }
    if (overrideYearlyOverpayment !== null && m % 12 === 0) {
      monthEndOverpayment += overrideYearlyOverpayment;
    }

    let additionalCostThisMonth = 0;
    if (m === 1) {
      additionalCostThisMonth += (params.additionalCosts?.initialFee || 0);
      additionalCostThisMonth += (params.additionalCosts?.insuranceFirstYear || 0);
    } 
    
    if (m > 12 && params.additionalCosts?.insuranceMonthly > 0 && params.additionalCosts?.insuranceEndDate) {
      const insEndDate = new Date(params.additionalCosts.insuranceEndDate);
      if (currentDate <= insEndDate) {
        additionalCostThisMonth += params.additionalCosts.insuranceMonthly;
      }
    }

    let suggestedOver = 0;
    if (!ignoreOverpaymentsData) {
      let canUseDeclared = true;
      const targetStart = overpayment.targetStartDate ? new Date(overpayment.targetStartDate) : null;
      if (targetStart && currentDate < targetStart) canUseDeclared = false;

      if (canUseDeclared && overpayment.targetInstallment > 0) {
        let currentTotalToPay = capitalPart + unpaidInterest + monthEndOverpayment + additionalCostThisMonth;
        if (currentTotalToPay < overpayment.targetInstallment) {
           suggestedOver = overpayment.targetInstallment - currentTotalToPay;
        }
      }
    }

    monthEndOverpayment += suggestedOver;

    let totalOver = monthEndOverpayment;
    let capitalToReduce = capitalPart + totalOver;

    if (capitalToReduce > tempBalance) {
      capitalToReduce = tempBalance;
    }

    balance = tempBalance - capitalToReduce;

    let totalCapitalReducedThisMonth = capitalToReduce;
    let totalInterestPaidThisMonth = unpaidInterest;

    let bankInstallment = capitalPart + unpaidInterest + additionalCostThisMonth;

    const realValueInstallment = bankInstallment / Math.pow(1 + monthlyInflation, m);

    schedule.push({
      id: m,
      type: 'installment',
      date: new Date(currentDate).toISOString(),
      installment: bankInstallment,
      capital: totalCapitalReducedThisMonth,
      interest: totalInterestPaidThisMonth,
      overpayment: totalOver,
      additionalCost: additionalCostThisMonth,
      balance: balance,
      realValueInstallment,
    });

    totalPaid += bankInstallment + totalOver;
    totalInterest += totalInterestPaidThisMonth;
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
