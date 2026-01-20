# Agent Changelog

## 2026-01-19 - Long Polling + Job Types Update

### Changes Made

1. **Long Polling Support**
   - Updated API client to use long polling with 30-second server timeout
   - Increased axios timeout to 65 seconds to accommodate long polling
   - Removed sleep delays between polls (server waits for jobs)
   - Immediate reconnection after 204 No Content responses

2. **Job Type Support**
   - Added support for `job_type` field: `prd_generation` and `code_execution`
   - Executor now routes jobs based on type

3. **PRD Generation**
   - Implemented `executePrdGeneration()` method
   - Uses Claude `/prd` skill to generate PRDs
   - Returns `prdContent` in completion payload

4. **Code Execution**
   - Refactored existing implementation into `executeCodeImplementation()`
   - Continues to use Claude `--print` for code implementation
   - Returns `summary` and `branchName` in completion payload

5. **API Updates**
   - `GET /api/v1/ralph/jobs/next?timeout=30` - long polling parameter
   - `PATCH /api/v1/ralph/jobs/:id` - now accepts `prd_content` parameter

### Files Modified

- `src/api-client.js` - Long polling support, prd_content handling
- `src/executor.js` - Job type routing, PRD generation
- `src/index.js` - Removed sleep delays for long polling

### Testing

1. **Reset Test Job:**
   ```bash
   # Job #1 has been reset to pending status
   # It's a PRD generation job for task "update 'Good afternoon' header to have a 😊 after it"
   ```

2. **Restart Agent:**
   ```bash
   cd ~/src/ralphblaster-agent
   npm start
   ```

3. **Expected Behavior:**
   - Agent will long poll (wait up to 30s for jobs)
   - Should immediately claim job #1
   - Execute Claude `/prd` skill
   - Send PRD content back to server
   - Server will store PRD and mark task as complete

### Environment Setup

Make sure your `.env` file has:
```
RALPH_API_URL=http://localhost:3000
RALPH_API_TOKEN=<your_token_here>
```

Get your API token from: http://localhost:3000/api_tokens

Make sure the token has `ralph_agent` permission enabled.

### Troubleshooting

**"timeout of 30000ms exceeded"**
- This was fixed by increasing axios timeout to 65s

**"500 Internal Server Error"**
- Check Rails logs for errors
- Ensure migrations have been run: `bin/rails db:migrate`

**Claude CLI not found**
- Ensure `claude` is in your PATH
- Test: `claude --version`

**Job stuck in "running"**
- Reset job: `bin/rails runner "RalphJob.find(ID).update!(status: :pending)"`
