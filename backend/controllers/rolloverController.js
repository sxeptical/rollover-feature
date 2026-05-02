const logger = require('../utils/logger');
const jobStore = require('../services/jobStore');
const pythonRunner = require('../services/pythonRunner');

const YEAR_REGEX = /^(?:(?:FY\s*)?\d{4}\s*[-–]\s*\d{4}|\d{4})$/i;

function validateRolloverInput(body) {
  const errors = [];
  if (!body.clientName || typeof body.clientName !== 'string' || body.clientName.trim().length === 0) {
    errors.push('clientName is required and must be a non-empty string');
  }
  if (!body.newFinancialYear || typeof body.newFinancialYear !== 'string') {
    errors.push('newFinancialYear is required and must be a string');
  } else if (!YEAR_REGEX.test(body.newFinancialYear)) {
    errors.push('newFinancialYear must match format "YYYY-YYYY", "FY YYYY-YYYY", or "YYYY"');
  }
  return errors;
}

async function createRollover(req, res, next) {
  try {
    const validationErrors = validateRolloverInput(req.body);
    if (validationErrors.length > 0) {
      logger.warn('Validation failed', {
        errors: validationErrors,
        clientName: req.body?.clientName,
        newFinancialYear: req.body?.newFinancialYear,
      });
      return res.status(400).json({ success: false, errors: validationErrors });
    }

    const { clientName, newFinancialYear } = req.body;
    const jobId = jobStore.create(clientName.trim(), newFinancialYear.trim());

    // Fire-and-forget: do NOT await
    pythonRunner.runRollover(jobId, clientName.trim(), newFinancialYear.trim())
      .catch((err) => {
        // Error already handled in pythonRunner; this prevents unhandled rejection
        logger.error(`Background rollover error`, { jobId, error: err.message });
      });

    logger.info(`Rollover job queued`, { jobId, clientName, newFinancialYear });
    return res.status(201).json({ success: true, jobId });
  } catch (err) {
    next(err);
  }
}

async function getStatus(req, res, next) {
  try {
    const { jobId } = req.params;
    const job = jobStore.get(jobId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    return res.status(200).json({
      success: true,
      jobId: job.jobId,
      status: job.status,
      logs: job.logs,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createRollover,
  getStatus
};
