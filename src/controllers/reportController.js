const reportService = require('../services/reportService');

/**
 * GET /api/reports/weekly?format=excel|csv|pdf&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
const generateWeeklyReport = async (req, res, next) => {
  try {
    const format = (req.query.format || 'excel').toLowerCase();
    const validFormats = ['excel', 'csv', 'pdf'];

    if (!validFormats.includes(format)) {
      return res.status(422).json({ error: `Invalid format. Use: ${validFormats.join(', ')}` });
    }

    // Default: current week
    let startDate = req.query.start_date;
    let endDate = req.query.end_date;

    if (!startDate || !endDate) {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      startDate = monday.toISOString().split('T')[0];
      endDate = sunday.toISOString().split('T')[0];
    }

    const reportData = await reportService.buildWeeklyReportData(startDate, endDate);

    const filename = `weekly-report-${startDate}-to-${endDate}`;

    if (format === 'excel') {
      const buffer = await reportService.generateExcel(reportData);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      return res.send(buffer);
    }

    if (format === 'csv') {
      const csvString = await reportService.generateCSV(reportData);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      return res.send(csvString);
    }

    if (format === 'pdf') {
      const buffer = await reportService.generatePDF(reportData, startDate, endDate);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
      return res.send(buffer);
    }
  } catch (err) {
    next(err);
  }
};

module.exports = { generateWeeklyReport };
