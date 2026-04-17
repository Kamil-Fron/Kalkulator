export interface Transza {
  date: string;
  amount: number;
}

export interface InterestRange {
  startMonth: number;
  endMonth: number;
  rate: number;
}

export interface OverpaymentStrategy {
  intervalMonths: number;
  amount: number;
  startDate: string;
  customData: Record<number, number>;
  targetInstallment: number;
  targetStartDate: string;
}

export interface RefinanceOption {
  active: boolean;
  month: number;
  newRate: number;
  newTermMonths: number;
}

export interface OneTimeOverpayment {
  id: string;
  date: string;
  amount: number;
}

export interface SimulationParams {
  loanAmount: number;
  termMonths: number;
  startDate: string;
  gracePeriodMonths: number;
  rateType: 'rowne' | 'malejace';
  firstMonthExtraAmount: number;
  interestRanges: InterestRange[];
  transzes: Transza[];
  overpayment: OverpaymentStrategy;
  refinance: RefinanceOption;
  inflationRate: number;
  oneTimeOverpayments?: OneTimeOverpayment[];
}

export interface ScheduleRow {
  id: number;
  date: string;
  installment: number;
  capital: number;
  interest: number;
  overpayment: number;
  balance: number;
  realValueInstallment: number;
}

export interface SimulationResult {
  schedule: ScheduleRow[];
  totalPaid: number;
  totalInterest: number;
  totalOverpayments: number;
  months: number;
  totalLoanAmount: number;
}

export interface Preset {
  id: string;
  name: string;
  params: SimulationParams;
}
