/**
 * Log Destinations Module
 *
 * Exports all available log destinations for easy importing.
 * Each destination implements the BaseDestination interface and can be
 * used independently or coordinated by LogManager.
 */

const BaseDestination = require('./base-destination');
const ConsoleDestination = require('./console-destination');
const FileDestination = require('./file-destination');
const ApiDestination = require('./api-destination');
const BatchedDestination = require('./batched-destination');
const ApiDestinationUnbatched = require('./api-destination-unbatched');
const LogManager = require('../log-manager');

module.exports = {
  BaseDestination,
  ConsoleDestination,
  FileDestination,
  ApiDestination,
  BatchedDestination,
  ApiDestinationUnbatched,
  LogManager
};
