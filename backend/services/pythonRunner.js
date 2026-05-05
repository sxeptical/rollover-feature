const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const jobStore = require('./jobStore');

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const VENV_PYTHON_PATH = path.resolve(__dirname, '..', 'rollover-backend', 'bin', 'python');
const PYTHON_PATH = process.env.PYTHON_PATH || (fs.existsSync(VENV_PYTHON_PATH) ? VENV_PYTHON_PATH : 'python3');
const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', 'rollover.py');

const activeProcesses = new Map(); // jobId -> ChildProcess

function runRollover(jobId, clientName, newFinancialYear, token) {
  return new Promise((resolve, reject) => {
    const archiveBase = process.env.DROPBOX_ARCHIVE_BASE;
    const clientsBase = process.env.DROPBOX_CLIENTS_BASE;
    if (!token) {
      const err = new Error('Dropbox token not provided');
      logger.error(err.message);
      return reject(err);
    }

    jobStore.update(jobId, { status: 'running' });
    logger.info(`Starting rollover job`, { jobId, clientName, newFinancialYear });

    const args = [
      SCRIPT_PATH,
      '--client', clientName,
      '--year', newFinancialYear,
      '--token', token
    ];
    if (archiveBase) {
      args.push('--archive', archiveBase);
    }
    if (clientsBase) {
      args.push('--clients', clientsBase);
    }

    const proc = spawn(PYTHON_PATH, args, {
      env: { ...process.env, DROPBOX_ACCESS_TOKEN: token },
      timeout: TIMEOUT_MS,
      killSignal: 'SIGTERM'
    });

    activeProcesses.set(jobId, proc);

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let timedOut = false;

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line) => {
        stdoutBuffer += line + '\n';
        jobStore.appendLog(jobId, `[stdout] ${line}`);
      });
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach((line) => {
        stderrBuffer += line + '\n';
        jobStore.appendLog(jobId, `[stderr] ${line}`);
      });
    });

    proc.on('error', (err) => {
      activeProcesses.delete(jobId);
      logger.error(`Process error`, { jobId, error: err.message });
      jobStore.update(jobId, { status: 'failed', error: err.message });
      reject(err);
    });

    proc.on('close', (code, signal) => {
      activeProcesses.delete(jobId);

      if (signal === 'SIGTERM' && code === null) {
        timedOut = true;
      }

      if (timedOut) {
        const errMsg = 'Rollover process timed out after 10 minutes';
        logger.error(errMsg, { jobId });
        jobStore.update(jobId, { status: 'failed', error: errMsg });
        return reject(new Error(errMsg));
      }

      const parseResultFromStdout = () => {
        const trimmed = stdoutBuffer.trim();
        if (!trimmed) return null;
        const lines = trimmed.split('\n').filter(Boolean);
        const lastLine = lines[lines.length - 1] || '{}';
        try {
          return JSON.parse(lastLine);
        } catch (e) {
          return null;
        }
      };

      if (code !== 0) {
        const parsed = parseResultFromStdout();
        const errMsg = parsed?.message || stderrBuffer.trim() || `Process exited with code ${code}`;
        logger.error(`Rollover failed`, { jobId, exitCode: code, error: errMsg });
        jobStore.update(jobId, { status: 'failed', error: errMsg });
        return reject(new Error(errMsg));
      }

      // Parse last non-empty line of stdout as JSON result
      const result = parseResultFromStdout() || { rawOutput: stdoutBuffer.trim() };

      logger.info(`Rollover completed`, { jobId, result });
      jobStore.update(jobId, { status: 'completed', result });
      resolve(result);
    });
  });
}

function killJob(jobId) {
  const proc = activeProcesses.get(jobId);
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    activeProcesses.delete(jobId);
    logger.info(`Killed job process`, { jobId });
    return true;
  }
  return false;
}

module.exports = {
  runRollover,
  killJob
};
