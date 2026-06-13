const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { supabaseAdmin } = require('../config/supabase');

/**
 * Fetch parcel data for the given date range
 */
const buildWeeklyReportData = async (startDate, endDate) => {
  const { data, error } = await supabaseAdmin
    .from('parcels')
    .select(
      `id, tracking_number, weight, status, arrival_date, shipment_date, delivery_date, total_cost, notes,
       customers(id, customer_code, first_name, last_name, email),
       warehouses(id, name, country)`
    )
    .gte('created_at', `${startDate}T00:00:00.000Z`)
    .lte('created_at', `${endDate}T23:59:59.999Z`)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return {
    startDate,
    endDate,
    parcels: data || [],
    totalParcels: (data || []).length,
    totalWeight: (data || []).reduce((sum, p) => sum + (parseFloat(p.weight) || 0), 0),
    totalRevenue: (data || []).reduce((sum, p) => sum + (parseFloat(p.total_cost) || 0), 0),
  };
};

/**
 * Generate Excel report using ExcelJS
 */
const generateExcel = async (reportData) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cargo Express 66';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Weekly Report');

  // Title row
  sheet.mergeCells('A1:J1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `Cargo Express 66 — Weekly Report (${reportData.startDate} to ${reportData.endDate})`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF6997CF' } };
  titleCell.alignment = { horizontal: 'center' };
  sheet.getRow(1).height = 30;

  // Summary row
  sheet.mergeCells('A2:J2');
  const summaryCell = sheet.getCell('A2');
  summaryCell.value = `Total Parcels: ${reportData.totalParcels}  |  Total Weight: ${reportData.totalWeight.toFixed(2)} kg  |  Total Revenue: $${reportData.totalRevenue.toFixed(2)}`;
  summaryCell.font = { bold: true, size: 11 };
  summaryCell.alignment = { horizontal: 'center' };
  sheet.getRow(2).height = 20;

  // Header row
  const headers = [
    { header: '#', key: 'num', width: 5 },
    { header: 'Tracking Number', key: 'tracking_number', width: 25 },
    { header: 'Customer Name', key: 'customer_name', width: 25 },
    { header: 'Customer ID', key: 'customer_code', width: 15 },
    { header: 'Weight (kg)', key: 'weight', width: 12 },
    { header: 'Warehouse', key: 'warehouse', width: 20 },
    { header: 'Status', key: 'status', width: 22 },
    { header: 'Arrival Date', key: 'arrival_date', width: 15 },
    { header: 'Total Cost ($)', key: 'total_cost', width: 14 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];

  sheet.columns = headers;

  const headerRow = sheet.getRow(3);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6997CF' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 20;

  // Set headers
  headers.forEach((h, idx) => {
    headerRow.getCell(idx + 1).value = h.header;
  });

  // Data rows
  reportData.parcels.forEach((parcel, index) => {
    const customerName = parcel.customers
      ? `${parcel.customers.first_name} ${parcel.customers.last_name}`
      : 'Unknown Recipient';

    const row = sheet.addRow({
      num: index + 1,
      tracking_number: parcel.tracking_number,
      customer_name: customerName,
      customer_code: parcel.customers?.customer_code || '-',
      weight: parcel.weight ? parseFloat(parcel.weight).toFixed(2) : '-',
      warehouse: parcel.warehouses ? `${parcel.warehouses.name} (${parcel.warehouses.country})` : '-',
      status: (parcel.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      arrival_date: parcel.arrival_date ? parcel.arrival_date.split('T')[0] : '-',
      total_cost: parcel.total_cost ? parseFloat(parcel.total_cost).toFixed(2) : '0.00',
      notes: parcel.notes || '',
    });

    // Alternate row colors
    if (index % 2 === 0) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F8FF' } };
    }

    row.alignment = { vertical: 'middle' };
  });

  // Auto-filter
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: headers.length },
  };

  // Freeze header rows
  sheet.views = [{ state: 'frozen', ySplit: 3 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
};

/**
 * Generate CSV report
 */
const generateCSV = async (reportData) => {
  const headers = [
    '#',
    'Tracking Number',
    'Customer Name',
    'Customer ID',
    'Weight (kg)',
    'Warehouse',
    'Status',
    'Arrival Date',
    'Total Cost ($)',
    'Notes',
  ];

  const rows = reportData.parcels.map((parcel, index) => {
    const customerName = parcel.customers
      ? `${parcel.customers.first_name} ${parcel.customers.last_name}`
      : 'Unknown Recipient';

    return [
      index + 1,
      parcel.tracking_number,
      customerName,
      parcel.customers?.customer_code || '-',
      parcel.weight ? parseFloat(parcel.weight).toFixed(2) : '-',
      parcel.warehouses ? `${parcel.warehouses.name} (${parcel.warehouses.country})` : '-',
      (parcel.status || '').replace(/_/g, ' '),
      parcel.arrival_date ? parcel.arrival_date.split('T')[0] : '-',
      parcel.total_cost ? parseFloat(parcel.total_cost).toFixed(2) : '0.00',
      `"${(parcel.notes || '').replace(/"/g, '""')}"`,
    ].join(',');
  });

  const csvLines = [
    `# Cargo Express 66 - Weekly Report (${reportData.startDate} to ${reportData.endDate})`,
    `# Total Parcels: ${reportData.totalParcels} | Total Weight: ${reportData.totalWeight.toFixed(2)} kg | Total Revenue: $${reportData.totalRevenue.toFixed(2)}`,
    headers.join(','),
    ...rows,
  ];

  return csvLines.join('\n');
};

/**
 * Generate PDF report using PDFKit
 */
const generatePDF = async (reportData, startDate, endDate) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Brand colors
    const BLUE = '#6997CF';
    const RED = '#FE000D';
    const DARK = '#333333';
    const GRAY = '#888888';

    // Header
    doc.rect(0, 0, doc.page.width, 80).fill(BLUE);
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
      .text('Cargo Express 66', 40, 20);
    doc.fontSize(12).font('Helvetica')
      .text(`Weekly Report: ${startDate} — ${endDate}`, 40, 48);

    // Summary box
    doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text('Report Summary', 40, 100);
    doc.rect(40, 115, 740, 50).stroke(BLUE);

    const summaryY = 130;
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    doc.text(`Total Parcels: ${reportData.totalParcels}`, 60, summaryY);
    doc.text(`Total Weight: ${reportData.totalWeight.toFixed(2)} kg`, 220, summaryY);
    doc.text(`Total Revenue: $${reportData.totalRevenue.toFixed(2)}`, 400, summaryY);

    // Table
    const tableTop = 185;
    const colWidths = [30, 120, 110, 80, 60, 100, 110, 80, 70];
    const colHeaders = ['#', 'Tracking Number', 'Customer', 'Customer ID', 'Weight', 'Warehouse', 'Status', 'Date', 'Cost ($)'];
    const startX = 40;

    // Table header
    doc.rect(startX, tableTop - 5, 740, 20).fill(BLUE);
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');

    let xPos = startX + 2;
    colHeaders.forEach((header, i) => {
      doc.text(header, xPos, tableTop, { width: colWidths[i] - 4, ellipsis: true });
      xPos += colWidths[i];
    });

    // Table rows
    let yPos = tableTop + 20;
    const rowHeight = 18;
    doc.fontSize(8).font('Helvetica');

    reportData.parcels.forEach((parcel, index) => {
      if (yPos > doc.page.height - 60) {
        doc.addPage({ layout: 'landscape' });
        yPos = 40;
        // Re-draw header on new page
        doc.rect(startX, yPos - 5, 740, 20).fill(BLUE);
        doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold');
        xPos = startX + 2;
        colHeaders.forEach((header, i) => {
          doc.text(header, xPos, yPos, { width: colWidths[i] - 4, ellipsis: true });
          xPos += colWidths[i];
        });
        yPos += 20;
        doc.fontSize(8).font('Helvetica');
      }

      // Alternate row bg
      if (index % 2 === 0) {
        doc.rect(startX, yPos - 3, 740, rowHeight).fill('#F5F8FF');
      }

      const customerName = parcel.customers
        ? `${parcel.customers.first_name} ${parcel.customers.last_name}`
        : 'Unknown';

      const rowData = [
        String(index + 1),
        parcel.tracking_number,
        customerName,
        parcel.customers?.customer_code || '-',
        parcel.weight ? `${parseFloat(parcel.weight).toFixed(2)} kg` : '-',
        parcel.warehouses ? parcel.warehouses.name : '-',
        (parcel.status || '').replace(/_/g, ' '),
        parcel.arrival_date ? parcel.arrival_date.split('T')[0] : '-',
        parcel.total_cost ? `$${parseFloat(parcel.total_cost).toFixed(2)}` : '$0.00',
      ];

      doc.fillColor(DARK);
      xPos = startX + 2;
      rowData.forEach((cell, i) => {
        doc.text(cell, xPos, yPos, { width: colWidths[i] - 4, ellipsis: true });
        xPos += colWidths[i];
      });

      // Row border
      doc.moveTo(startX, yPos + rowHeight - 3).lineTo(startX + 740, yPos + rowHeight - 3)
        .strokeColor('#DDDDDD').stroke();

      yPos += rowHeight;
    });

    // Footer
    doc.fillColor(GRAY).fontSize(9)
      .text(
        `Generated by Cargo Express 66 on ${new Date().toLocaleDateString()}`,
        40,
        doc.page.height - 40,
        { align: 'center' }
      );

    doc.end();
  });
};

module.exports = { buildWeeklyReportData, generateExcel, generateCSV, generatePDF };
