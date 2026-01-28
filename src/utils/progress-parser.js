const logger = require('../logger');

/**
 * ProgressParser - Extracts meaningful progress updates from Claude output
 *
 * Instead of streaming every chunk, this parser identifies key milestones
 * and sends structured progress updates to the UI.
 */
class ProgressParser {
  constructor(apiClient, jobId, jobType) {
    this.apiClient = apiClient;
    this.jobId = jobId;
    this.jobType = jobType; // 'prd_generation', 'code_execution', etc.

    // Track what we've already reported to avoid duplicates
    this.reportedMilestones = new Set();

    // Buffer to accumulate chunks for pattern matching
    this.buffer = '';
    this.maxBufferSize = 10000; // Keep last 10KB for context

    // Milestones specific to PRD generation
    this.prdMilestones = [
      { pattern: /reading.*requirements|analyzing.*requirements/i, message: 'Analyzing requirements', event: 'analyzing' },
      { pattern: /reading.*files|exploring.*codebase/i, message: 'Exploring codebase', event: 'exploring' },
      { pattern: /understanding.*context|gathering.*context/i, message: 'Understanding project context', event: 'context' },
      { pattern: /generating.*prd|creating.*document|writing.*requirements/i, message: 'Generating PRD document', event: 'generating' },
      { pattern: /generating.*sections|writing.*sections/i, message: 'Writing PRD sections', event: 'writing_sections' },
      { pattern: /reviewing.*structure|organizing.*content/i, message: 'Organizing content', event: 'organizing' },
      { pattern: /finalizing|completing|wrapping up/i, message: 'Finalizing document', event: 'finalizing' }
    ];

    // Milestones for clarifying questions
    this.clarifyingMilestones = [
      { pattern: /analyzing.*requirements|understanding.*request/i, message: 'Analyzing your request', event: 'analyzing' },
      { pattern: /identifying.*questions|generating.*questions/i, message: 'Identifying clarifying questions', event: 'identifying' },
      { pattern: /structuring.*questions|formatting.*questions/i, message: 'Structuring questions', event: 'structuring' }
    ];

    // Enhanced tool usage patterns with detailed extraction
    this.toolExtractors = [
      {
        pattern: /Read(?:ing)?\s+(?:file\s+)?['"`]?([^'"`\n]+?)['"`]?(?:\s|$|\.)/i,
        extract: (match) => `Reading ${this.formatFilename(match[1])}`,
        event: 'tool_read'
      },
      {
        pattern: /Glob(?:bing)?\s+(?:pattern\s+)?['"`]?([^'"`\n]+?)['"`]?(?:\s|$|\.)/i,
        extract: (match) => `Scanning files matching ${match[1].trim()}`,
        event: 'tool_glob'
      },
      {
        pattern: /Grep(?:ping)?\s+(?:for\s+)?['"`]([^'"`\n]+)['"`]/i,
        extract: (match) => `Searching for "${match[1].trim()}"`,
        event: 'tool_grep'
      },
      {
        pattern: /(?:Write|Writing|Edit|Editing)\s+(?:file\s+)?['"`]?([^'"`\n]+?)['"`]?(?:\s|$|\.)/i,
        extract: (match) => `Modifying ${this.formatFilename(match[1])}`,
        event: 'tool_write'
      },
      {
        pattern: /Using\s+(\w+)\s+tool/i,
        extract: (match) => `Using ${match[1]} tool`,
        event: 'tool_generic'
      }
    ];

    // Progress indicators (task completion)
    this.progressIndicators = [
      { pattern: /completed|finished|done with/i, increment: 10 },
      { pattern: /starting|beginning/i, increment: 5 }
    ];

    this.currentProgress = 0;
    this.lastProgressUpdate = 0;
    this.lastProgressTime = 0;

    // Track last message for backward compatibility
    this.lastMessage = null;
  }

  /**
   * Format filename for display (truncate long paths)
   * @param {string} filepath - Full file path
   * @returns {string} Formatted filename
   */
  formatFilename(filepath) {
    if (!filepath) return '';

    // Remove quotes and whitespace
    const cleaned = filepath.trim().replace(/['"]/g, '');

    // If it's a short path, return as-is
    if (cleaned.length <= 40) return cleaned;

    // Extract filename and show last 2 directories
    const parts = cleaned.split('/');
    if (parts.length > 2) {
      return '...' + parts.slice(-2).join('/');
    }

    // Truncate long single filenames
    return cleaned.slice(0, 37) + '...';
  }

  /**
   * Process a chunk of Claude output and send meaningful updates
   * @param {string} chunk - Raw output chunk from Claude
   */
  async processChunk(chunk) {
    // Add to buffer
    this.buffer += chunk;

    // Trim buffer if it gets too large
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(-this.maxBufferSize);
    }

    // Check for milestones
    await this.checkMilestones();

    // Update progress percentage
    await this.updateProgress(chunk);
  }

  /**
   * Check buffer for milestone patterns and send updates
   */
  async checkMilestones() {
    const milestones = this.jobType === 'clarifying_questions'
      ? this.clarifyingMilestones
      : this.prdMilestones;

    // Check job-specific milestones
    for (const milestone of milestones) {
      if (milestone.pattern.test(this.buffer) && !this.reportedMilestones.has(milestone.event)) {
        await this.sendStatusUpdate(milestone.event, milestone.message);
        this.reportedMilestones.add(milestone.event);
        logger.debug(`Progress milestone: ${milestone.event}`);
      }
    }

    // Check tool usage patterns with enhanced extraction
    for (const extractor of this.toolExtractors) {
      const match = this.buffer.match(extractor.pattern);
      if (match) {
        const now = Date.now();
        // Throttle tool updates to max once per 2 seconds per tool type
        const lastReport = this.reportedMilestones.has(`${extractor.event}_last`)
          ? this.reportedMilestones.get(`${extractor.event}_last`)
          : 0;

        if (now - lastReport > 2000) {
          const message = extractor.extract(match);
          await this.sendStatusUpdate(extractor.event, message);
          this.reportedMilestones.set(`${extractor.event}_last`, now);
          this.lastMessage = message; // Track for backward compatibility
        }
      }
    }
  }

  /**
   * Update progress percentage based on indicators in the chunk
   */
  async updateProgress(chunk) {
    for (const indicator of this.progressIndicators) {
      if (indicator.pattern.test(chunk)) {
        this.currentProgress = Math.min(90, this.currentProgress + indicator.increment);

        // Only send progress updates if significant change (>10%) and not too frequent
        const now = Date.now();
        if (this.currentProgress - this.lastProgressUpdate >= 10 &&
            now - this.lastProgressTime > 5000) {
          await this.sendProgressUpdate(this.currentProgress);
          this.lastProgressUpdate = this.currentProgress;
          this.lastProgressTime = now;
        }
        break;
      }
    }
  }

  /**
   * Send a status event to the API/UI
   */
  async sendStatusUpdate(eventType, message) {
    if (!this.apiClient) return;

    // Track last message for backward compatibility
    this.lastMessage = message;

    try {
      await this.apiClient.sendStatusEvent(
        this.jobId,
        eventType,
        message
      );
    } catch (error) {
      logger.debug(`Failed to send status update: ${error.message}`);
      // Don't throw - status updates are best-effort
    }
  }

  /**
   * Send a progress percentage update
   */
  async sendProgressUpdate(percentage) {
    if (!this.apiClient) return;

    try {
      await this.apiClient.sendStatusEvent(
        this.jobId,
        'progress_update',
        `${percentage}% complete`,
        { percentage }
      );
    } catch (error) {
      logger.debug(`Failed to send progress update: ${error.message}`);
    }
  }

  /**
   * Mark job as complete (100%)
   */
  async markComplete() {
    this.currentProgress = 100;
    await this.sendProgressUpdate(100);
  }

  /**
   * Get total unique milestones reported
   */
  getMilestonesReported() {
    return Array.from(this.reportedMilestones).filter(m => !m.endsWith('_last'));
  }

  /**
   * Get the last milestone message sent
   * Used for backward compatibility with onProgress callbacks
   * @returns {string|null} Last message or null
   */
  getLastMilestoneMessage() {
    return this.lastMessage;
  }
}

module.exports = ProgressParser;
