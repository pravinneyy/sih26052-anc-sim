const path = require('path');
const express = require('express');
const { port, publicDir } = require('./config/server.config');
const requestLogger = require('./middlewares/requestLogger');
const notFound = require('./middlewares/notFound');
const routes = require('./routes/index.routes');

const app = express();
const ORT_WEB_DIST = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist');

app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));
// Serves the ONNX Runtime Web wasm binaries the Audio Lab's live CRN/GRU
// engine loads — kept out of public/ since it's a build dependency, not
// project source. Only reachable through this server, not file://.
app.use('/vendor/onnxruntime-web', express.static(ORT_WEB_DIST));
app.use('/api', routes);
app.use(notFound);

app.listen(port, () => {
  console.log(`ANC demo server: http://localhost:${port}`);
  console.log(`Serving: ${publicDir}`);
  console.log('This server is a local-dev convenience only — public/index.html');
  console.log('also opens directly via file:// with no server, per the demo spec.');
});
