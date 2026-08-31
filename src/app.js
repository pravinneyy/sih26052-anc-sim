const express = require('express');
const { port, publicDir } = require('./config/server.config');
const requestLogger = require('./middlewares/requestLogger');
const notFound = require('./middlewares/notFound');
const routes = require('./routes/index.routes');

const app = express();

app.use(requestLogger);
app.use(express.static(publicDir));
app.use('/api', routes);
app.use(notFound);

app.listen(port, () => {
  console.log(`ANC demo server: http://localhost:${port}`);
  console.log(`Serving: ${publicDir}`);
  console.log('This server is a local-dev convenience only — public/index.html');
  console.log('also opens directly via file:// with no server, per the demo spec.');
});
