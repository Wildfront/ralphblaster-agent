const fs = require('fs');
const path = require('path');
const os = require('os');
const safeJsonParse = require('secure-json-parse');

/**
 * Config File Manager
 * Handles reading and writing to ~/.ralphblasterrc
 */
class ConfigFileManager {
  constructor() {
    this.configPath = path.join(os.homedir(), '.ralphblasterrc');
  }

  /**
   * Check if config file exists
   */
  exists() {
    return fs.existsSync(this.configPath);
  }

  /**
   * Read config file
   * Returns null if file doesn't exist or is invalid
   */
  read() {
    try {
      if (!this.exists()) {
        return null;
      }

      const content = fs.readFileSync(this.configPath, 'utf8');

      // Security: Validate config file size (prevent DoS from maliciously large files)
      const MAX_CONFIG_SIZE = 100 * 1024; // 100KB should be plenty for config
      if (content.length > MAX_CONFIG_SIZE) {
        console.error(`Warning: Config file ${this.configPath} is too large (${content.length} bytes, max ${MAX_CONFIG_SIZE})`);
        return null;
      }

      // Security: Use safe JSON parser to prevent prototype pollution
      return safeJsonParse.parse(content, null, {
        protoAction: 'remove',
        constructorAction: 'remove'
      });
    } catch (error) {
      console.error(`Warning: Could not read ${this.configPath}:`, error.message);
      return null;
    }
  }

  /**
   * Write config file
   */
  write(config) {
    try {
      const content = JSON.stringify(config, null, 2);
      fs.writeFileSync(this.configPath, content, { mode: 0o600 }); // Only user can read/write
      return true;
    } catch (error) {
      throw new Error(`Failed to write config file: ${error.message}`);
    }
  }

  /**
   * Update specific config values
   */
  update(updates) {
    const currentConfig = this.read() || {};
    const newConfig = { ...currentConfig, ...updates };
    this.write(newConfig);
    return newConfig;
  }

  /**
   * Get a specific config value
   */
  get(key) {
    const config = this.read();
    return config ? config[key] : null;
  }
}

module.exports = ConfigFileManager;
