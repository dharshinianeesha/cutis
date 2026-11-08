const serverless = require('serverless-http');
const { app } = require('../../backend/app');
const handle = serverless(app);
exports.handler = (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  return handle(event, context);
};
