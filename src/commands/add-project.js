const InitCommand = require('./init');

/**
 * AddProject Command
 * Alias for init command - adds the current directory as a RalphBlaster project
 */
class AddProjectCommand extends InitCommand {
  /**
   * Run the add-project command
   * This is just an alias for the init command
   */
  async run() {
    return super.run();
  }
}

module.exports = AddProjectCommand;
