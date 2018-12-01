const bunyan = require('bunyan');
const bunyanFormat = require('bunyan-format')();

const logger = bunyan.createLogger({
  name: 'local',
  level: process.env.loglevel || 'info',
  stream: bunyanFormat
});

module.exports = logger;
