import jsPDF from 'jspdf';

// Builds a 1099-NEC SUMMARY PDF for a single contractor and triggers a download.
// This is a recipient-friendly summary, not the IRS Copy A. The official Copy A
// must be filed on red-form paper or e-filed via the IRS / a service.
//
// payer:     { name, address, city, state, zip, ein, phone }
// recipient: { name, address, city, state, zip, tin, email, phone }   // tin/address may be blank
// year:      2026
// amount:    nonemployee compensation in dollars
export function generate1099NecPdf({ payer, recipient, year, amount }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' }); // 612 × 792
  const W = 612, M = 48;
  let y = M;

  // Header band
  doc.setFillColor(45, 122, 95);
  doc.rect(0, 0, W, 64, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Form 1099-NEC — Recipient Summary', M, 28);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Tax year ${year}  ·  Nonemployee Compensation`, M, 46);

  // Disclaimer
  y = 88;
  doc.setTextColor(120);
  doc.setFontSize(8.5);
  doc.text(
    'This summary is provided to the recipient for record-keeping. The official IRS Copy A',
    M, y);
  doc.text(
    'must be filed on the red-ink form (or e-filed). Recipient is responsible for reporting this',
    M, y + 11);
  doc.text(
    'income on their tax return.',
    M, y + 22);

  // Two-column blocks: payer (left) / recipient (right)
  y = 140;
  const colW = (W - M * 2 - 16) / 2;
  doc.setDrawColor(220);
  doc.setLineWidth(0.6);

  // Payer box
  doc.rect(M, y, colW, 130);
  doc.setTextColor(60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('PAYER  (your salon)', M + 8, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(payer.name || '—', M + 8, y + 36);
  doc.setFontSize(10);
  if (payer.address) doc.text(payer.address, M + 8, y + 52);
  const payerCSZ = [payer.city, payer.state, payer.zip].filter(Boolean).join(' ');
  if (payerCSZ) doc.text(payerCSZ, M + 8, y + 67);
  if (payer.phone) doc.text(`Phone: ${payer.phone}`, M + 8, y + 87);
  doc.setFont('helvetica', 'bold');
  doc.text('Payer EIN:', M + 8, y + 110);
  doc.setFont('helvetica', 'normal');
  doc.text(payer.ein || '__-_______', M + 70, y + 110);

  // Recipient box
  const rx = M + colW + 16;
  doc.rect(rx, y, colW, 130);
  doc.setTextColor(60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('RECIPIENT  (contractor)', rx + 8, y + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(recipient.name || '—', rx + 8, y + 36);
  doc.setFontSize(10);
  doc.text(recipient.address || '________________________', rx + 8, y + 52);
  const recCSZ = [recipient.city, recipient.state, recipient.zip].filter(Boolean).join(' ') || '________________________';
  doc.text(recCSZ, rx + 8, y + 67);
  if (recipient.email) doc.text(recipient.email, rx + 8, y + 87);
  doc.setFont('helvetica', 'bold');
  doc.text('Recipient TIN:', rx + 8, y + 110);
  doc.setFont('helvetica', 'normal');
  doc.text(recipient.tin || '___-__-____', rx + 90, y + 110);

  // Box 1 — Nonemployee compensation
  y = 300;
  doc.setFillColor(245, 247, 250);
  doc.rect(M, y, W - M * 2, 80, 'F');
  doc.setDrawColor(200);
  doc.rect(M, y, W - M * 2, 80);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text('BOX 1 — NONEMPLOYEE COMPENSATION', M + 14, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(140);
  doc.text(`Total service revenue earned in ${year} (post-discount, before tip).`,
    M + 14, y + 37);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(45, 122, 95);
  doc.text(formatMoney(amount), W - M - 14, y + 60, { align: 'right' });

  // Other boxes (zeros — common for service contractors)
  y = 400;
  const boxes = [
    ['Box 2', 'Payer made direct sales totaling $5,000+ of consumer products', '☐'],
    ['Box 4', 'Federal income tax withheld', '$0.00'],
    ['Box 5', 'State tax withheld',          '$0.00'],
    ['Box 6', 'State / Payer\'s state no.',  '—'],
    ['Box 7', 'State income',                 '$0.00'],
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  boxes.forEach((row, i) => {
    const ry = y + i * 20;
    doc.setFont('helvetica', 'bold');
    doc.text(row[0], M, ry);
    doc.setFont('helvetica', 'normal');
    doc.text(row[1], M + 38, ry);
    doc.text(row[2], W - M, ry, { align: 'right' });
  });

  // Footer
  y = 720;
  doc.setDrawColor(220);
  doc.line(M, y, W - M, y);
  doc.setTextColor(140);
  doc.setFontSize(8);
  doc.text(
    `Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}  ·  ${payer.name || 'Salon'}`,
    M, y + 14);
  doc.text(
    'Not a substitute for IRS Copy A. Verify amounts before filing.',
    W - M, y + 14, { align: 'right' });

  const fname = `1099-NEC_${(recipient.name || 'recipient').replace(/\s+/g, '_')}_${year}.pdf`;
  doc.save(fname);
}

function formatMoney(n) {
  return `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
