# Phase 1 - Backend API Endpoint Required

## Overview

Phase 1 of the logging cleanup adds a new API endpoint to send internal operational logs to the UI's "Instance Setup Logs" section. The agent code has been updated to call this endpoint, but the backend (ralphblaster) needs to implement it.

## Required Backend Changes

### 1. Add New API Endpoint

**Route:** `PATCH /api/v1/ralphblaster/jobs/:id/setup_log`

**Controller:** `Api::V1::Ralphblaster::JobsController`

**Action:**
```ruby
# Add to app/controllers/api/v1/ralphblaster_jobs_controller.rb

def add_setup_log
  # Authorize the request (existing before_action should handle this)
  authorize_ralphblaster_agent!

  # Get the task associated with this job
  task = @ralphblaster_job.task

  # Initialize ralphblaster_logs array if it doesn't exist
  task.ralphblaster_logs ||= []

  # Append the new log entry
  task.ralphblaster_logs << {
    timestamp: params[:timestamp],
    level: params[:level],        # 'info' or 'error'
    message: params[:message]
  }

  # Save the task
  if task.save
    head :ok
  else
    render json: { error: 'Failed to save log' }, status: :unprocessable_entity
  end
end
```

### 2. Add Route

**File:** `config/routes.rb`

```ruby
# Inside the existing namespace :api do / namespace :v1 do / resources :ralphblaster do block
namespace :ralphblaster do
  resources :jobs, only: [:index, :show, :update] do
    member do
      patch :progress
      post :events
      patch :metadata
      patch :setup_log  # ADD THIS LINE
    end
  end
end
```

### 3. Strong Parameters (if needed)

Add to the private methods section of `Ralphblaster::JobsController`:

```ruby
private

def setup_log_params
  params.permit(:timestamp, :level, :message)
end
```

Then update the action to use it:
```ruby
def add_setup_log
  authorize_ralph_agent!

  task = @ralphblaster_job.task
  task.ralphblaster_logs ||= []

  # Use strong parameters
  log_params = setup_log_params

  task.ralphblaster_logs << {
    timestamp: log_params[:timestamp],
    level: log_params[:level],
    message: log_params[:message]
  }

  if task.save
    head :ok
  else
    render json: { error: 'Failed to save log' }, status: :unprocessable_entity
  end
end
```

## How It Works

### Agent Side (Already Implemented)

1. When a job starts, `logger.setJobContext(jobId, apiClient)` is called
2. All `logger.info()` and `logger.error()` calls now send to both:
   - Terminal (console.log) - as before
   - API endpoint (PATCH /jobs/:id/setup_log) - NEW
3. When job completes, `logger.clearJobContext()` is called

### UI Side (No Changes Needed)

The existing UI code in `app/views/tickets/_ralph_progress.html.erb` already displays `task.ralphblaster_logs`:

```erb
<% if ticket.ralphblaster_logs.present? %>
  <div class="font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
    <% ticket.ralphblaster_logs.each do |log| %>
      <div class="<%= log['level'] == 'error' ? 'text-red-400' : 'text-green-400' %>">
        <%= Time.parse(log['timestamp']).strftime('%H:%M:%S') %> <%= log['message'] %>
      </div>
    <% end %>
  </div>
<% end %>
```

So once the backend stores logs in `task.ralphblaster_logs`, they automatically appear in the UI!

## Expected Result

### Before Phase 1
**Instance Setup Logs** show minimal info:
```
17:17:08 Task queued for agent execution
17:17:08 Job claimed by agent (token: RalphBlaster Agent)
17:22:40 Job completed successfully
```

### After Phase 1
**Instance Setup Logs** show full operational details:
```
17:17:08 Task queued for agent execution
17:17:08 Job claimed by agent (token: RalphBlaster Agent)
17:17:09 Creating worktree for job 1414
17:17:12 Created worktree on branch ralph/lighter-background-color
17:17:13 Starting PRD conversion (input size: 58234 bytes)
17:17:58 PRD conversion completed in 45s
17:18:02 Launching Claude with max 10 iterations
17:22:37 Ralph completed all tasks
17:22:40 Job completed successfully
```

## Testing

### 1. Test the Endpoint Manually

```bash
# Start the ralphblaster server
cd ~/src/ralphblaster
rails server

# In another terminal, test the endpoint
curl -X PATCH http://localhost:3000/api/v1/ralphblaster/jobs/1234/setup_log \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "timestamp": "2025-01-23T10:30:45.123Z",
    "level": "info",
    "message": "Test log message"
  }'

# Should return 200 OK
# Check task.ralphblaster_logs in rails console
```

### 2. Test with Real Agent Execution

```bash
# Start the agent
cd ~/src/ralphblaster-agent
npm start

# Trigger a job from the UI
# Watch the Instance Setup Logs section - you should see all operational logs appear
```

## Graceful Degradation

The agent code is designed to fail gracefully if this endpoint doesn't exist yet:

- Logs continue to appear in the agent's terminal
- API calls fail silently (best-effort)
- Job execution continues normally
- Activity Timeline and Live Progress sections continue to work

So you can deploy the agent changes immediately, and logs will start appearing in the UI once the backend endpoint is added.

## Next Steps (Phase 2-3)

Future phases will add:
- Batch logging endpoint for performance (10 logs → 1 API call)
- Cleanup of "EXTRA LOUD" debugging logs
- Enhanced structured logging with context

But Phase 1 alone solves the core visibility gap!
