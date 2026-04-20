import React, { useState, useEffect, useMemo } from 'react';
import { simulateSchedule } from './lib/simulation';
import { exportToCsv, exportToPdf } from './lib/export';
import { defaultParams } from './lib/defaults';
import { SimulationParams, SimulationResult, Preset } from './lib/types';
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { Download, FileText, Save, FolderOpen, Plus, Trash2, Calculator, TrendingDown } from 'lucide-react';

export default function App() {
  const [params, setParams] = useState<SimulationParams>(defaultParams as any);
  const [simRes, setSimRes] = useState<SimulationResult | null>(null);
  const [analysisDate, setAnalysisDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Target calculation state
  const [targetYears, setTargetYears] = useState<number>(0);
  const [targetResult, setTargetResult] = useState<string>('');

  // Presets state
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState<string>('');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // Chart view template
  const [chartTemplate, setChartTemplate] = useState<'standard' | 'capital_interest' | 'inflation'>('standard');

  useEffect(() => {
    const saved = localStorage.getItem('loan_presets');
    if (saved) {
      try {
        setPresets(JSON.parse(saved));
      } catch (e) { }
    }
  }, []);

  useEffect(() => {
    const res = simulateSchedule(params);
    setSimRes(res);
  }, [params]);

  const savePreset = () => {
    if (!presetName) return;
    const newId = Date.now().toString();
    const newPresets = [...presets, { id: newId, name: presetName, params }];
    setPresets(newPresets);
    localStorage.setItem('loan_presets', JSON.stringify(newPresets));
    setActivePresetId(newId);
    setPresetName('');
  };

  const updatePreset = () => {
    if (!activePresetId) return;
    const newPresets = presets.map(p => p.id === activePresetId ? { ...p, params } : p);
    setPresets(newPresets);
    localStorage.setItem('loan_presets', JSON.stringify(newPresets));
  };

  const loadPreset = (preset: Preset) => {
    setParams(preset.params);
    setActivePresetId(preset.id);
    setPresetName(preset.name);
  };

  const deletePreset = (id: string) => {
    const newPresets = presets.filter(p => p.id !== id);
    setPresets(newPresets);
    localStorage.setItem('loan_presets', JSON.stringify(newPresets));
    if (activePresetId === id) {
      setActivePresetId(null);
      setPresetName('');
    }
  };

  const clearData = () => {
    if (window.confirm('Czy na pewno chcesz usunąć wszystkie parametry z formularza?')) {
      setParams({
        ...defaultParams as SimulationParams,
        loanAmount: 0,
        firstMonthExtraAmount: 0,
        interestRanges: [],
        transzes: [],
        oneTimeOverpayments: [],
        overpayment: { type: 'cyclic' as any, intervalMonths: 0, amount: 0, startDate: '', customData: {}, targetInstallment: 0, targetStartDate: '' },
        refinance: { active: false, month: 0, newRate: 0, newTermMonths: 0 }
      });
      setActivePresetId(null);
      setPresetName('');
    }
  };

  const handleParamChange = (field: keyof SimulationParams, value: any) => {
    setParams(prev => ({ ...prev, [field]: value }));
  };

  const calculateTarget = () => {
    if (!targetYears || targetYears <= 0) return;
    const baseSim = simulateSchedule(params, 0, 0, false, true);
    if (!baseSim) return;
    const targetMonths = baseSim.months - (targetYears * 12);
    if (targetMonths <= 0) {
      setTargetResult("Niemożliwe - kredyt byłby krótszy niż 0 m-cy.");
      return;
    }

    let low = 0, high = baseSim.totalLoanAmount;
    let optimalMonthly = 0;
    for (let i = 0; i < 30; i++) {
      const mid = (low + high) / 2;
      const sim = simulateSchedule(params, mid, 0, false, true);
      if (sim.months <= targetMonths) { optimalMonthly = mid; high = mid; } else { low = mid; }
    }

    low = 0; high = baseSim.totalLoanAmount * 12;
    let optimalYearly = 0;
    for (let i = 0; i < 30; i++) {
        const mid = (low + high) / 2;
        const sim = simulateSchedule(params, 0, mid, false, true);
        if (sim.months <= targetMonths) { optimalYearly = mid; high = mid; } else { low = mid; }
    }

    setTargetResult(`Aby skrócić kredyt o ${targetYears} lat:\n1. Dopłacaj miesięcznie: ${optimalMonthly.toFixed(0)} zł\n2. LUB rocznie: ${optimalYearly.toFixed(0)} zł`);
  };


  const formatMoney = (val: number) => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(val);

  // Computed for Dashboard
  const currentMonthIdx = useMemo(() => {
    if (!simRes) return 0;
    const d = new Date(analysisDate);
    const idx = simRes.schedule.findIndex(s => new Date(s.date) >= d && s.type === 'installment');
    return idx === -1 ? simRes.schedule.length : idx;
  }, [simRes, analysisDate]);

  const progressData = useMemo(() => {
    if (!simRes) return { paidCap: 0, paidInt: 0, remaining: 0, currentInstallment: 0 };
    let pc = 0, pi = 0;
    for (let i = 0; i < currentMonthIdx && i < simRes.schedule.length; i++) {
      pc += (simRes.schedule[i].capital + simRes.schedule[i].overpayment);
      pi += simRes.schedule[i].interest;
    }
    const rem = currentMonthIdx > 0 && currentMonthIdx <= simRes.schedule.length 
      ? simRes.schedule[currentMonthIdx - 1].balance : simRes.totalLoanAmount;
    
    // Find the current installment row directly if we point to an overpayment row
    let instRow = currentMonthIdx < simRes.schedule.length ? simRes.schedule[currentMonthIdx] : null;
    let fallbackInst = instRow && instRow.type === 'installment' ? instRow.installment : 0;
    if (instRow && instRow.type !== 'installment') {
        const nextInstRow = simRes.schedule.slice(currentMonthIdx).find(r => r.type === 'installment');
        if (nextInstRow) fallbackInst = nextInstRow.installment;
    }

    return { paidCap: pc, paidInt: pi, remaining: rem, currentInstallment: fallbackInst };
  }, [simRes, currentMonthIdx]);

  const pcPercent = simRes && simRes.totalLoanAmount > 0 ? (progressData.paidCap / simRes.totalLoanAmount) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 font-sans">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 text-center pt-8">
          <h1 className="text-4xl font-bold text-slate-800 tracking-tight">Kalkulator Kredytowy PRO</h1>
          <p className="text-slate-500 mt-2 text-lg">Symulacje, nadpłaty, refinansowanie i wskaźniki rynkowe</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* LEFT COLUMN: Parametry wejściowe */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* Presets */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md">
              <div className="flex justify-between items-center border-b pb-3 mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2 text-slate-800"><FolderOpen className="w-5 h-5 text-teal-600"/> Szablony / Menu</h3>
                <button onClick={clearData} className="text-xs bg-red-50 text-red-600 hover:bg-red-100 font-bold px-3 py-1.5 rounded-lg transition-colors border border-red-100 shadow-sm">
                  Wyczyść Formularz
                </button>
              </div>
              <div className="flex gap-2">
                <input 
                  type="text" value={presetName} onChange={e => setPresetName(e.target.value)}
                  placeholder="Nazwa szablonu"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
                />
                <button onClick={savePreset} disabled={!presetName} className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-1 text-sm font-bold shadow-sm" title="Zapisz nowy"><Save className="w-4 h-4"/> Zapisz</button>
                {activePresetId && (
                  <button onClick={updatePreset} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg transition-colors text-sm font-bold shadow-sm disabled:opacity-50" title="Zaktualizuj wczytany szablon">Aktualizuj</button>
                )}
              </div>
              {presets.length > 0 && (
                <div className="mt-4 space-y-2">
                  {presets.map(p => (
                    <div key={p.id} className={`flex items-center justify-between p-3 rounded-lg border text-sm transition-colors ${activePresetId === p.id ? 'bg-teal-50 border-teal-200 shadow-sm' : 'bg-slate-50 hover:bg-slate-100 border-slate-200'}`}>
                      <span className={`font-semibold cursor-pointer flex-1 ${activePresetId === p.id ? 'text-teal-800' : 'text-slate-700'}`} onClick={() => loadPreset(p)}>{p.name} {activePresetId === p.id && '(Wczytany)'}</span>
                      <button onClick={() => deletePreset(p.id)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4"/></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Params */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
              <h3 className="text-lg font-bold border-b pb-3 text-slate-800">1. Parametry Kredytu</h3>
              
              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-700">Kwota kredytu (PLN)</label>
                <input type="number" value={params.loanAmount} onChange={e => handleParamChange('loanAmount', +e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1 text-slate-700">Okres (lata)</label>
                  <input type="number" value={params.termMonths / 12} onChange={e => handleParamChange('termMonths', (+e.target.value)*12)} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1 text-slate-700">Data startu</label>
                  <input type="date" value={params.startDate} onChange={e => handleParamChange('startDate', e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-1 text-slate-700">Karencja (m-ce)</label>
                  <input type="number" value={params.gracePeriodMonths} onChange={e => handleParamChange('gracePeriodMonths', +e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1 text-slate-700">Rodzaj rat</label>
                  <select value={params.rateType} onChange={e=>handleParamChange('rateType', e.target.value as any)} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all bg-white">
                    <option value="rowne">Równe</option>
                    <option value="malejace">Malejące</option>
                  </select>
                </div>
              </div>

              <div className="pt-5 border-t">
                <label className="block text-sm font-semibold mb-3 text-slate-700">Oprocentowanie (%)</label>
                {params.interestRanges.map((r, i) => (
                  <div key={i} className="flex gap-2 mb-2 items-center">
                    <input type="number" placeholder="Od (msc)" value={r.startMonth} onChange={e => {
                      const nr = [...params.interestRanges]; nr[i].startMonth = +e.target.value; handleParamChange('interestRanges', nr);
                    }} className="w-20 px-3 py-1.5 border border-slate-300 rounded-md text-sm outline-none focus:ring-1 focus:ring-teal-500" />
                    <span className="text-slate-400">-</span>
                    <input type="number" placeholder="Do (msc)" value={r.endMonth} onChange={e => {
                      const nr = [...params.interestRanges]; nr[i].endMonth = +e.target.value; handleParamChange('interestRanges', nr);
                    }} className="w-20 px-3 py-1.5 border border-slate-300 rounded-md text-sm outline-none focus:ring-1 focus:ring-teal-500" />
                    <input type="number" step="0.01" placeholder="Rata %" value={r.rate} onChange={e => {
                      const nr = [...params.interestRanges]; nr[i].rate = +e.target.value; handleParamChange('interestRanges', nr);
                    }} className="flex-1 px-3 py-1.5 border border-slate-300 rounded-md text-sm font-medium outline-none focus:ring-1 focus:ring-teal-500" />
                    <button onClick={() => {
                        const nr = [...params.interestRanges]; nr.splice(i,1); handleParamChange('interestRanges', nr);
                    }} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4"/></button>
                  </div>
                ))}
                <button onClick={() => handleParamChange('interestRanges', [...params.interestRanges, {startMonth: 1, endMonth: 12, rate: 5}])} className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1 mt-3 px-2 py-1 bg-teal-50 rounded transition-colors">
                  <Plus className="w-3 h-3"/> Dodaj zmianę (WIBOR/WIRON)
                </button>
              </div>

              <div className="pt-5 border-t">
                <label className="block text-sm font-semibold mb-1 text-slate-700">Wpływ Inflacji (średnio rocznie %)</label>
                <input type="number" step="0.1" value={params.inflationRate} onChange={e => handleParamChange('inflationRate', +e.target.value)} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">Pozwala na oszacowanie realnej (nabywczej) wartości płaconej raty w kolejnych latach trwania umowy, z uwzględnieniem regularnej utraty siły nabywczej pieniądza (PV).</p>
              </div>
            </div>

            {/* Inne Koszty (Ubezpieczenia, Prowizje) */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-lg font-bold border-b pb-3 text-slate-800">2. Koszty początkowe i Ubezpieczenie</h3>
              
              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-700">Koszty początkowe banku uiszczane "z góry" (PLN)</label>
                <input type="number" value={params.additionalCosts?.initialFee || ''} onChange={e => handleParamChange('additionalCosts', {...params.additionalCosts, initialFee: +e.target.value})} placeholder="np. prowizja, notariusz" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all text-sm" />
              </div>
              
              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-700">Ubezpieczenie (kwota jednorazowa za 1. rok w PLN)</label>
                <input type="number" value={params.additionalCosts?.insuranceFirstYear || ''} onChange={e => handleParamChange('additionalCosts', {...params.additionalCosts, insuranceFirstYear: +e.target.value})} placeholder="np. 2000" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-4 pb-2 border-b border-slate-100">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">Ubezpieczenie pomostowe/życie (miesięcznie po 1 r.)</label>
                  <input type="number" value={params.additionalCosts?.insuranceMonthly || ''} onChange={e => handleParamChange('additionalCosts', {...params.additionalCosts, insuranceMonthly: +e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">Płatne miesięcznie DO (data)</label>
                  <input type="date" value={params.additionalCosts?.insuranceEndDate || ''} onChange={e => handleParamChange('additionalCosts', {...params.additionalCosts, insuranceEndDate: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-700">Jednorazowa wpłata/wkład umniejszający 1. kapitał</label>
                <input type="number" value={params.firstMonthExtraAmount || ''} onChange={e => handleParamChange('firstMonthExtraAmount', +e.target.value)} placeholder="Dodatkowa wpłata wraz z uruchomieniem rat" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all text-sm" />
                <p className="text-xs text-slate-500 mt-2">Działa jak jednorazowe obniżenie kapitału początkowego tuż po wypłacie kredytu.</p>
              </div>
            </div>

            {/* Tranches */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-lg font-bold border-b pb-3 text-slate-800">3. Transze (Wypłata w częściach)</h3>
              {params.transzes.map((t, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <input type="date" value={t.date.split('T')[0]} onChange={e => {
                    const nt = [...params.transzes]; nt[i].date = e.target.value; handleParamChange('transzes', nt);
                  }} className="flex-1 px-3 py-1.5 border border-slate-300 rounded-md text-sm outline-none focus:ring-1 focus:ring-teal-500" />
                  <input type="number" placeholder="Kwota" value={t.amount} onChange={e => {
                    const nt = [...params.transzes]; nt[i].amount = +e.target.value; handleParamChange('transzes', nt);
                  }} className="w-32 px-3 py-1.5 border border-slate-300 rounded-md text-sm font-medium outline-none focus:ring-1 focus:ring-teal-500" />
                  <button onClick={() => {
                      const nt = [...params.transzes]; nt.splice(i,1); handleParamChange('transzes', nt);
                  }} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4"/></button>
                </div>
              ))}
              <div className="flex gap-2 pt-2">
                <button onClick={() => handleParamChange('transzes', [...params.transzes, {date: params.startDate, amount: 50000}])} className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1 px-3 py-1.5 bg-teal-50 rounded transition-colors w-full justify-center">
                  <Plus className="w-4 h-4"/> Dodaj Transzę
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2">Domyślnie cały kredyt wypłacany jest w dniu startu (jeśli brak transz lub pierwsza jest w dniu startu kredytu, tak zostanie przeliczone).</p>
            </div>

            {/* Nadpłaty */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
              <h3 className="text-lg font-bold border-b pb-3 text-slate-800">4. Nadpłaty Kapitału</h3>

              {/* Jednorazowe */}
              <div className="pb-3 border-b border-slate-100">
                <label className="block text-sm font-semibold mb-3 text-slate-700">Nadpłaty jednorazowe (w tym historyczne)</label>
                {params.oneTimeOverpayments?.map((ot, i) => (
                  <div key={ot.id} className="flex gap-2 mb-2 items-center">
                    <input type="date" value={ot.date} onChange={e => {
                      const mapped = [...(params.oneTimeOverpayments || [])]; mapped[i].date = e.target.value; handleParamChange('oneTimeOverpayments', mapped);
                    }} className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-1 focus:ring-teal-500" />
                    <input type="number" placeholder="Kwota PLN" value={ot.amount || ''} onChange={e => {
                      const mapped = [...(params.oneTimeOverpayments || [])]; mapped[i].amount = +e.target.value; handleParamChange('oneTimeOverpayments', mapped);
                    }} className="w-32 px-3 py-1.5 border border-slate-300 rounded-lg text-sm font-medium outline-none focus:ring-1 focus:ring-teal-500" />
                    <button onClick={() => {
                        const mapped = [...(params.oneTimeOverpayments || [])]; mapped.splice(i,1); handleParamChange('oneTimeOverpayments', mapped);
                    }} className="text-red-400 hover:text-red-600 p-1 bg-red-50 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <button onClick={() => handleParamChange('oneTimeOverpayments', [...(params.oneTimeOverpayments || []), {id: Date.now().toString(), date: params.startDate, amount: 10000}])} className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center justify-center gap-1 px-3 py-2 bg-teal-50 rounded-lg transition-colors w-full border border-teal-100">
                    <Plus className="w-4 h-4"/> Dodaj Nadpłatę Jednorazową
                  </button>
                </div>
              </div>

              {/* Cykliczne */}
              <label className="block text-sm font-semibold mt-4 mb-2 text-slate-700">Nadpłaty cykliczne</label>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">Kwota nadpłaty (PLN)</label>
                  <input type="number" value={params.overpayment.amount} onChange={e => handleParamChange('overpayment', {...params.overpayment, amount: +e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-slate-500">Co ile m-cy</label>
                  <input type="number" value={params.overpayment.intervalMonths} onChange={e => handleParamChange('overpayment', {...params.overpayment, intervalMonths: +e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1 text-slate-700">Data startu nadpłat</label>
                <input type="date" value={params.overpayment.startDate} onChange={e => handleParamChange('overpayment', {...params.overpayment, startDate: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
              </div>
              <div className="pt-5 border-t">
                <label className="block text-sm font-semibold mb-2 text-teal-800">Utrzymaj stałą płatność (Nadpłacaj do)</label>
                <div className="grid grid-cols-2 gap-4">
                  <input type="number" placeholder="Np. 4000 PLN" value={params.overpayment.targetInstallment || ''} onChange={e => handleParamChange('overpayment', {...params.overpayment, targetInstallment: +e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" title="Docelowa stała kwota jaką chcesz płacić co miesiąc" />
                  <input type="date" value={params.overpayment.targetStartDate || ''} onChange={e => handleParamChange('overpayment', {...params.overpayment, targetStartDate: e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                </div>
              </div>
            </div>

            {/* Refinansowanie */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex items-center gap-3 border-b pb-3">
                <input type="checkbox" checked={params.refinance.active} onChange={e => handleParamChange('refinance', {...params.refinance, active: e.target.checked})} className="w-5 h-5 text-teal-600 rounded border-slate-300" />
                <h3 className="text-lg font-bold text-slate-800">5. Refinansowanie</h3>
              </div>
              {params.refinance.active && (
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-slate-700">Od m-ca nr</label>
                    <input type="number" value={params.refinance.month} onChange={e => handleParamChange('refinance', {...params.refinance, month: +e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-1 text-slate-700">Nowe Oproc. (%)</label>
                    <input type="number" step="0.1" value={params.refinance.newRate} onChange={e => handleParamChange('refinance', {...params.refinance, newRate: +e.target.value})} className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-semibold mb-1 text-slate-700">Nowy okres kredytu (lata)</label>
                    <input type="number" value={params.refinance.newTermMonths ? params.refinance.newTermMonths/12 : ''} onChange={e => handleParamChange('refinance', {...params.refinance, newTermMonths: (+e.target.value)*12})} placeholder="Puste = brak zmian" className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                  </div>
                </div>
              )}
            </div>
            
          </div>


          {/* RIGHT COLUMN: Wyniki, Analizy, Wykresy */}
          <div className="lg:col-span-8 space-y-6">
            
            {/* Status Panel */}
            <div className="bg-gradient-to-br from-teal-50 flex items-center justify-between to-emerald-100 p-6 rounded-2xl border border-teal-200 shadow-sm relative overflow-hidden">
              <div className="w-full">
                <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between mb-6">
                  <div>
                    <h3 className="text-teal-900 font-extrabold text-xl tracking-tight mb-2">Twój Status z Przyszłości</h3>
                    <input type="date" value={analysisDate} onChange={e => setAnalysisDate(e.target.value)} className="px-3 py-1.5 border border-teal-300 rounded-lg shadow-sm text-sm font-medium focus:ring-2 focus:ring-teal-500 outline-none" />
                  </div>
                  <div className="bg-white/60 px-5 py-3 rounded-xl border border-teal-200/50 backdrop-blur-sm self-stretch md:self-auto flex flex-col justify-center">
                    <p className="text-xs text-teal-800 font-bold uppercase tracking-wider mb-1">Rata na ten dzień nr:</p>
                    <p className="text-4xl font-black text-teal-900">{currentMonthIdx}</p>
                  </div>
                </div>
                
                <div className="w-full bg-white/50 rounded-full h-5 mb-6 border border-teal-200/80 p-0.5 overflow-hidden relative shadow-inner">
                  <div className="bg-gradient-to-r from-teal-500 to-emerald-500 h-full rounded-full transition-all duration-1000 ease-out flex items-center justify-end px-2" style={{ width: `${Math.max(5, Math.min(pcPercent, 100))}%` }}>
                    <span className="text-[10px] font-bold text-white drop-shadow-md">{pcPercent.toFixed(1)}%</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white/80 p-4 rounded-xl border border-white shadow-sm backdrop-blur-sm">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Kapitał spłacony</p>
                    <p className="text-lg font-black text-emerald-600">{formatMoney(progressData.paidCap)}</p>
                  </div>
                  <div className="bg-white/80 p-4 rounded-xl border border-white shadow-sm backdrop-blur-sm">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Odsetki zapłacone</p>
                    <p className="text-lg font-black text-rose-500">{formatMoney(progressData.paidInt)}</p>
                  </div>
                  <div className="bg-white/80 p-4 rounded-xl border border-white shadow-sm backdrop-blur-sm">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Do spłaty</p>
                    <p className="text-lg font-black text-slate-800">{formatMoney(progressData.remaining)}</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border-l-4 border-l-teal-500 shadow-sm border border-white">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Bieżąca Rata</p>
                    <p className="text-lg font-black text-teal-700">{formatMoney(progressData.currentInstallment)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Target Calculator */}
            <div className="bg-indigo-50/50 p-6 rounded-2xl border border-indigo-100 shadow-sm">
              <h3 className="text-indigo-900 font-bold text-lg mb-4 flex items-center gap-2"><TrendingDown className="w-5 h-5 text-indigo-500"/> Kiedy Spłacę? (Analiza Skrócenia)</h3>
              <div className="flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 w-full relative">
                  <label className="block text-xs font-bold text-indigo-700 mb-2 uppercase tracking-wide">O ile lat chcę skrócić ten kredyt?</label>
                  <input type="number" value={targetYears} onChange={e=>setTargetYears(+e.target.value)} placeholder="Np. 5" className="w-full px-4 py-3 border border-indigo-200 rounded-xl font-medium focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <button onClick={calculateTarget} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-2 whitespace-nowrap">
                  <Calculator className="w-5 h-5"/> Przeprowadź Symulację
                </button>
              </div>
              {targetResult && (
                <div className="mt-5 p-4 bg-white border border-indigo-100 rounded-xl text-indigo-900 whitespace-pre-line text-sm font-semibold shadow-sm leading-relaxed">
                  {targetResult}
                </div>
              )}
            </div>

            {/* Podsumowanie */}
            {simRes && (
               <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-2">Całkowity Koszt</p>
                    <p className="text-xl font-black text-slate-800">{formatMoney(simRes.totalPaid)}</p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-2">Suma Odsetek</p>
                    <p className="text-xl font-black text-rose-500">{formatMoney(simRes.totalInterest)}</p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-2 text-center text-nowrap whitespace-nowrap">Dodatkowe Koszty <br/><span className="text-[9px]">(Start, Prowizje, Ubezp.)</span></p>
                    <p className="text-xl font-black text-orange-500">{formatMoney(simRes.totalAdditionalCosts)}</p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-2">Suma Nadpłat</p>
                    <p className="text-xl font-black text-emerald-600">{formatMoney(simRes.totalOverpayments)}</p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center">
                    <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider mb-2">Liczba Rat</p>
                    <p className="text-xl font-black text-slate-800">{simRes.months} m-cy</p>
                  </div>
               </div>
            )}

            {/* Wykresy */}
            <div className="bg-white p-6 rounded-2xl border shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between border-b pb-4 mb-6 gap-4">
                  <h3 className="text-lg font-bold text-slate-800">Wizualizacja Harmonogramu</h3>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => setChartTemplate('standard')} className={`text-xs px-4 py-2 rounded-full font-bold transition-all shadow-sm ${chartTemplate === 'standard' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Bilans</button>
                    <button onClick={() => setChartTemplate('capital_interest')} className={`text-xs px-4 py-2 rounded-full font-bold transition-all shadow-sm ${chartTemplate === 'capital_interest' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Odsetki vs Kapitał</button>
                    <button onClick={() => setChartTemplate('inflation')} className={`text-xs px-4 py-2 rounded-full font-bold transition-all shadow-sm flex items-center gap-1 ${chartTemplate === 'inflation' ? 'bg-teal-600 text-white ring-2 ring-teal-200 ring-offset-2' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>Moc Pieniądza (Wpływ Inflacji)</button>
                  </div>
                </div>
                
                <div className="h-[400px] w-full">
                  {simRes && simRes.schedule.length > 0 && (
                    <ResponsiveContainer width="100%" height="100%">
                      {chartTemplate === 'standard' ? (
                        <AreaChart data={simRes.schedule} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorSaldo" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.5}/>
                              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="id" tick={{fontSize: 11, fill: '#94a3b8', fontWeight: 600}} axisLine={false} tickLine={false} />
                          <YAxis tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} width={50} tick={{fontSize: 11, fill: '#94a3b8', fontWeight: 600}} axisLine={false} tickLine={false} />
                          <Tooltip formatter={(val: number) => formatMoney(val)} labelFormatter={(lbl) => `Rata nr: ${lbl}`} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'}} />
                          <Legend wrapperStyle={{fontSize: 12, fontWeight: 600, paddingTop: '10px'}} />
                          <Area type="monotone" name="Saldo Kredytu" dataKey="balance" stroke="#0ea5e9" strokeWidth={3} fillOpacity={1} fill="url(#colorSaldo)" />
                          <Line type="monotone" name="Wysokość Raty" dataKey="installment" stroke="#f59e0b" strokeWidth={3} dot={false} yAxisId={0} />
                        </AreaChart>
                      ) : chartTemplate === 'capital_interest' ? (
                        <AreaChart data={simRes.schedule.map((r, i) => {
                          let accInt = simRes.schedule.slice(0, i+1).reduce((acc, curr) => acc + curr.interest, 0);
                          let accCap = simRes.schedule.slice(0, i+1).reduce((acc, curr) => acc + (curr.capital + curr.overpayment), 0);
                          return { ...r, accInt, accCap };
                        })} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                           <XAxis dataKey="id" tick={{fontSize: 11, fill: '#94a3b8', fontWeight: 600}} axisLine={false} tickLine={false} />
                           <YAxis tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} width={50} tick={{fontSize: 11, fill: '#94a3b8', fontWeight: 600}} axisLine={false} tickLine={false} />
                           <Tooltip formatter={(val: number) => formatMoney(val)} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                           <Legend wrapperStyle={{fontSize: 12, fontWeight: 600, paddingTop: '10px'}} />
                           <Area type="monotone" dataKey="accCap" name="Skumulowany Spłacony Kapitał" stackId="1" stroke="#10b981" strokeWidth={0} fill="#10b981" fillOpacity={0.8} />
                           <Area type="monotone" dataKey="accInt" name="Skumulowane Odsetki" stackId="1" stroke="#ef4444" strokeWidth={0} fill="#ef4444" fillOpacity={0.8} />
                        </AreaChart>
                      ) : (
                        <LineChart data={simRes.schedule} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                           <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                           <XAxis dataKey="id" tick={{fontSize: 11, fill: '#94a3b8', fontWeight: 600}} axisLine={false} tickLine={false} />
                           <YAxis tickFormatter={(v) => `${(v).toFixed(0)}`} width={50} tick={{fontSize: 11, fill: '#94a3b8', fontWeight: 600}} axisLine={false} tickLine={false} />
                           <Tooltip formatter={(val: number) => formatMoney(val)} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}} />
                           <Legend wrapperStyle={{fontSize: 12, fontWeight: 600, paddingTop: '10px'}} />
                           <Line type="monotone" name="Rata Nominalna (Płacona Bankowi)" dataKey="installment" stroke="#94a3b8" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                           <Line type="monotone" name={`Wartość Nabywcza Raty (przy inflacji ${params.inflationRate}%)`} dataKey="realValueInstallment" stroke="#8b5cf6" strokeWidth={4} dot={false} />
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  )}
                </div>
            </div>

            {/* Export Buttons */}
            <div className="flex justify-end gap-4">
              <button onClick={() => simRes && exportToCsv(simRes)} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md transition-all active:scale-95">
                <Download className="w-4 h-4"/> Pobierz CSV
              </button>
              <button onClick={() => simRes && exportToPdf(simRes)} className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-md transition-all active:scale-95">
                <FileText className="w-4 h-4"/> Wygeneruj PDF
              </button>
            </div>

            {/* Tabela */}
            <div className="bg-white rounded-2xl border shadow-sm overflow-hidden flex flex-col h-[500px]">
              <div className="h-full overflow-y-auto w-full relative">
                 <table className="w-full text-sm text-left">
                    <thead className="text-[10px] uppercase font-bold tracking-wider bg-slate-50 text-slate-500 sticky top-0 z-10 w-full shadow-sm">
                     <tr>
                       <th className="px-5 py-4">Lp. (Opis)</th>
                       <th className="px-5 py-4">Data</th>
                       <th className="px-5 py-4 text-right">Rata (Bank)</th>
                       <th className="px-5 py-4 text-right">Kapitał</th>
                       <th className="px-5 py-4 text-right">Odsetki</th>
                       <th className="px-5 py-4 text-right">Nadpłata</th>
                       <th className="px-5 py-4 text-right">Inne (Doliczone)</th>
                       <th className="px-5 py-4 text-right">Saldo</th>
                     </tr>
                   </thead>
                   <tbody>
                     {simRes?.schedule.map((r, i) => (
                       <tr key={`${r.id}-${i}`} className={`border-b border-slate-100 ${r.type === 'overpayment' ? 'bg-teal-50/60' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-slate-100/50 transition-colors ${r.id === currentMonthIdx ? 'bg-amber-50 border-amber-200 border-y-2 relative' : ''}`}>
                         <td className="px-5 py-3 text-slate-500 font-medium">
                            {r.type === 'overpayment' ? 'Nadpłata' : r.id}
                         </td>
                         <td className="px-5 py-3 text-slate-600">{(new Date(r.date)).toLocaleDateString('pl-PL')}</td>
                         <td className="px-5 py-3 text-right font-bold text-slate-800">{r.type === 'overpayment' ? '-' : formatMoney(r.installment)}</td>
                         <td className="px-5 py-3 text-right text-emerald-600 font-medium">{formatMoney(r.capital)}</td>
                         <td className="px-5 py-3 text-right text-rose-500 font-medium">{formatMoney(r.interest)}</td>
                         <td className="px-5 py-3 text-right text-teal-600 font-medium">{formatMoney(r.overpayment)}</td>
                         <td className="px-5 py-3 text-right text-orange-500 font-medium">{formatMoney(r.additionalCost)}</td>
                         <td className="px-5 py-3 text-right font-black text-slate-800">{formatMoney(r.balance)}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
              </div>
            </div>

          </div>
        </div>
        
        <footer className="mt-12 text-center text-slate-400 text-sm pb-8">
            Pamiętaj: symulacje opierają się na założeniach i nie stanowią wiążącej oferty. Wartości realne zależą od przyszłej inflacji oraz zmian WIBOR/WIRON.
        </footer>
      </div>
    </div>
  );
}