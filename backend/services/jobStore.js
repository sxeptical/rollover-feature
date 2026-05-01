const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const CLEANUP_MS = 24 * 60 * 60 * 1000; // 24 hours

const jobs = new Map();

function create(clientName, newFinancialYear) {
  const jobId = uuidv4();
  const now = new Date().toISOString();
  const job = {
    jobId,
    status: 'pending',
    clientName,
    newFinancialYear,
    createdAt: now,
    updatedAt: now,
    logs: [],
    result: null,
    error: null
  };
  jobs.set(jobId, job);
  logger.info(`Job created`, { jobId, clientName, newFinancialYear });
  return jobId;
}

function get(jobId) {
  cleanup();
  const job = jobs.get(jobId);
  if (!job) {
    logger.warn(`Job not found`, { jobId });
  }
  return job;
}

function update(jobId, updates) {
  const job = jobs.get(jobId);
  if (!job) return false;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  jobs.set(jobId, job);
  return true;
}

function appendLog(jobId, logLine) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.logs.push(logLine);
  job.updatedAt = new Date().toISOString();
  jobs.set(jobId, job);
  logger.debug(`Job log`, { jobId, log: logLine });
  return true;
}

function cleanup() {
  const now = Date.now();
  let removed = 0;
  for (const [jobId, job] of jobs.entries()) {
    const updated = new Date(job.updatedAt).getTime();
    if (now - updated > CLEANUP_MS) {
      jobs.delete(jobId);
      removed++;
    }
  }
  if (removed > 0) {
    logger.info(`Cleaned up ${removed} stale jobs`);
  }
}

function getAll() {
  cleanup();
  return Array.from(jobs.values());
}

module.exports = {
  create,
  get,
  update,
  appendLog,
  getAll
};
