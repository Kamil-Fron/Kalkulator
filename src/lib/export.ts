import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SimulationResult } from './types';

export function exportToCsv(sim: SimulationResult, filename: string = 'harmonogram.csv') {
  if (!sim || sim.schedule.length === 0) return;

  const f = (n: number) => n.toFixed(2).replace('.', ',');

  let csv = 'Lp;Data;Rata Całkowita;Kapitał;Odsetki;Nadpłata;Saldo;Wartość Realna (po inflacji)\n';
  sim.schedule.forEach((r) => {
    const d = new Date(r.date).toLocaleDateString('pl-PL');
    csv += `${r.id};${d};${f(r.installment)};${f(r.capital)};${f(r.interest)};${f(r.overpayment)};${f(r.balance)};${f(r.realValueInstallment)}\n`;
  });

  // Adding BOM for Excel
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function exportToPdf(sim: SimulationResult, filename: string = 'raport_kredytu.pdf') {
  if (!sim || sim.schedule.length === 0) return;

  const doc = new jsPDF();
  const f = (n: number) => n.toFixed(2).replace('.', ',');

  doc.setFontSize(18);
  doc.text('Raport Symulacji Kredytu', 14, 20);

  doc.setFontSize(11);
  doc.text(`Całkowity koszt: ${f(sim.totalPaid)} PLN`, 14, 30);
  doc.text(`Suma odsetek: ${f(sim.totalInterest)} PLN`, 14, 37);
  doc.text(`Suma nadpłat: ${f(sim.totalOverpayments)} PLN`, 14, 44);
  doc.text(`Liczba rat: ${sim.months}`, 14, 51);

  const tableData = sim.schedule.map((r) => [
    r.id,
    new Date(r.date).toLocaleDateString('pl-PL'),
    f(r.installment),
    f(r.capital),
    f(r.interest),
    f(r.overpayment),
    f(r.balance),
  ]);

  autoTable(doc, {
    startY: 60,
    head: [['Lp.', 'Data', 'Rata', 'Kapitał', 'Odsetki', 'Nadpłata', 'Saldo']],
    body: tableData,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [15, 23, 42] }, // tailwind slate-900
  });

  doc.save(filename);
}
