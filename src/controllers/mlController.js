const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DEFAULT_CHECKPOINT = path.join(ROOT_DIR, 'models', 'crn_gru_voice_mask.pt');
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, 'outputs', 'enhanced');
const DEFAULT_REPORT = path.join(DEFAULT_OUT_DIR, 'report.csv');
const BATCH_SCRIPT = path.join(ROOT_DIR, 'sih_python', 'batch_enhance_crn_gru.py');

function resolveLocal(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
}

function batchEnhance(req, res) {
  const body = req.body || {};
  const inputDir = body.inputDir ? resolveLocal(body.inputDir) : null;
  const checkpoint = resolveLocal(body.checkpoint, DEFAULT_CHECKPOINT);
  const outDir = resolveLocal(body.outDir, DEFAULT_OUT_DIR);
  const report = resolveLocal(body.report, DEFAULT_REPORT);
  const maxFiles = Number.parseInt(body.maxFiles, 10);

  if (!inputDir) {
    return res.status(400).json({ ok: false, error: 'inputDir is required' });
  }
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 500) {
    return res.status(400).json({ ok: false, error: 'maxFiles must be an integer from 1 to 500' });
  }

  const python = process.env.PYTHON || 'python';
  const args = [
    BATCH_SCRIPT,
    '--checkpoint', checkpoint,
    '--input-dir', inputDir,
    '--max-files', String(maxFiles),
    '--out-dir', outDir,
    '--report', report,
  ];

  const child = spawn(python, args, {
    cwd: ROOT_DIR,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let stdout = '';
  let stderr = '';
  let responded = false;
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', err => {
    responded = true;
    res.status(500).json({ ok: false, error: err.message });
  });
  child.on('close', code => {
    if (responded) return;
    if (code !== 0) {
      return res.status(500).json({ ok: false, code, stdout, stderr });
    }
    res.json({ ok: true, stdout, stderr, report, outDir });
  });
}

module.exports = { batchEnhance };
