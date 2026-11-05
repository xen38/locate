/**
 * Locate Harness Adapters
 *
 * Modular adapter system for parsing session archives from different
 * AI coding harnesses. Each adapter implements a common interface for
 * discovery, parsing, and text extraction.
 */

const { BaseAdapter } = require('./base')
const { SQLiteAdapter } = require('./sqlite')
const { JsonlAdapter } = require('./jsonl')
const { JsonAdapter } = require('./json')
const { TextAdapter } = require('./text')
const { AdapterRegistry, detectHarness } = require('./registry')

module.exports = {
  BaseAdapter,
  SQLiteAdapter,
  JsonlAdapter,
  JsonAdapter,
  TextAdapter,
  AdapterRegistry,
  detectHarness
}
