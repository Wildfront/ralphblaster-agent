# Prompt Template Recommendations for Autonomous Execution

## Current Architecture

The Ralph Blaster Agent receives **pre-formatted prompts** from the Rails application via `job.prompt`. The agent doesn't build prompts - it validates and executes them:

```javascript
// Agent side (src/executor/job-handlers/*.js)
const prompt = job.prompt;  // Received from Rails
validatePrompt(prompt);     // Security check
runClaude(prompt, ...);     // Execute as-is
```

**Implication:** To make Claude more autonomous, the prompt templates must be updated **on the Rails side**, not in the agent.

---

## Problem Analysis

Based on your experience, Claude stops and asks for confirmation when:

1. ❌ Prompt doesn't explicitly say "don't ask"
2. ❌ Scope is unclear or open-ended
3. ❌ Multiple approaches are valid
4. ❌ Changes might be destructive
5. ❌ Requirements need clarification

**Current behavior you experienced:**
- Completed 6/8 tasks
- Stopped to ask: "Want me to continue with task #7?"
- Reason: Conservative approach, unclear if you wanted review before documentation

---

## Recommended Prompt Patterns

### Pattern 1: Explicit Autonomy Statement
**Add to EVERY prompt template:**

```
IMPORTANT: Work autonomously through completion without stopping to ask for
confirmation. Only ask questions if there are genuinely unclear requirements
that prevent you from proceeding.
```

### Pattern 2: Scope Boundaries
**Define what "complete" means:**

```
Your task is complete when:
- All code changes are implemented and tested
- All files are committed to git
- Tests pass
- No TODO comments remain

Work through each step without pausing.
```

### Pattern 3: Decision-Making Authority
**Give Claude permission to make decisions:**

```
You have authority to make implementation decisions including:
- Choosing appropriate libraries/tools
- Determining file structure
- Writing tests in the appropriate style
- Making reasonable architectural choices

Proceed with your best judgment without asking for approval on these details.
```

### Pattern 4: Clarification Boundaries
**Define when to ask vs when to decide:**

```
DO ask if:
- The feature requirements are fundamentally unclear
- There are multiple conflicting requirements
- Security implications are uncertain

DO NOT ask about:
- Implementation approach (choose the best one)
- Code style (follow existing patterns)
- Testing strategy (write appropriate tests)
- Minor details (use your judgment)
```

---

## Prompt Template Updates by Job Type

### 1. Code Execution (code_execution)

**Current prompt likely looks like:**
```
Please implement the following feature:

{user_task_description}

Project: {project_name}
Working directory: {project_path}
```

**Enhanced version:**
```
AUTONOMOUS EXECUTION MODE: Complete this task fully without stopping for
confirmation. Only ask questions if requirements are fundamentally unclear.

Task: {user_task_description}

Project: {project_name}
Working directory: {project_path}

Your task is complete when:
✓ All code changes are implemented
✓ Tests are written and passing
✓ Changes are committed to git with clear commit message
✓ No TODO or FIXME comments remain

You have authority to:
- Choose appropriate implementation approaches
- Select libraries and tools
- Make architectural decisions
- Write tests in the project's style
- Refactor code for clarity

DO NOT stop to ask about:
- Which approach to use (choose the best one)
- Code organization (follow existing patterns)
- Testing strategy (write appropriate tests)
- Style choices (match the codebase)

DO stop and ask if:
- The core requirement is ambiguous or contradictory
- Security implications are unclear
- Major architectural changes are needed that affect other features

Proceed with implementation now.
```

---

### 2. PRD Generation (prd_generation)

**Current prompt likely looks like:**
```
Generate a Product Requirements Document for:

{user_task_description}

Include:
- Problem statement
- User stories
- Technical approach
- Success criteria
```

**Enhanced version:**
```
AUTONOMOUS EXECUTION MODE: Complete the PRD fully without stopping for
confirmation. Use your best judgment on structure and detail level.

Generate a comprehensive Product Requirements Document for:

{user_task_description}

Your PRD is complete when it includes:
✓ Clear problem statement
✓ User stories with acceptance criteria
✓ Technical approach with rationale
✓ Success metrics
✓ Edge cases considered
✓ Implementation phases if applicable

You have authority to:
- Choose the level of technical detail
- Decide on document structure
- Include or exclude optional sections based on complexity
- Make assumptions about user personas (state them clearly)

DO NOT stop to ask about:
- Format/structure (use professional PRD format)
- Level of detail (include what's needed for clarity)
- Technical specificity (appropriate to audience)

DO stop and ask if:
- The feature request is genuinely ambiguous
- Multiple contradictory requirements exist
- Major business decisions are required

Proceed with PRD generation now. Output the complete PRD in markdown format.
```

---

### 3. Plan Generation (prd_generation with mode: plan)

**Current prompt likely looks like:**
```
Generate an implementation plan for:

{user_task_description}

Break down into phases and tasks.
```

**Enhanced version:**
```
AUTONOMOUS EXECUTION MODE: Generate a complete implementation plan without
stopping for confirmation.

Create an implementation plan for:

{user_task_description}

Your plan is complete when it includes:
✓ Clear phases with dependencies
✓ Specific tasks per phase
✓ Estimated complexity (T-shirt sizes)
✓ Risk areas identified
✓ Testing strategy per phase

You have authority to:
- Break work into appropriate phases
- Suggest specific technical approaches
- Identify and plan for edge cases
- Recommend tools and libraries
- Propose architectural patterns

DO NOT stop to ask about:
- Phase breakdown (use your judgment)
- Task granularity (appropriate for the team)
- Technical choices (propose the best approach)

DO stop and ask if:
- Requirements are fundamentally unclear
- Major architectural decisions affect multiple systems
- Security or compliance implications need clarification

Proceed with plan generation now. Output the complete plan in markdown format.
```

---

### 4. Clarifying Questions (clarifying_questions)

**This job type is special - it SHOULD ask questions, but should do so autonomously:**

**Enhanced version:**
```
AUTONOMOUS EXECUTION MODE: Generate clarifying questions without stopping
for meta-confirmation.

Generate clarifying questions for:

{user_task_description}

Generate 3-7 questions that would help clarify the requirements. Focus on:
- Ambiguous requirements
- Missing acceptance criteria
- Edge cases to consider
- Technical constraints
- User experience details

Output format:
{
  "questions": [
    {
      "question": "...",
      "rationale": "...",
      "category": "functional|technical|ux|business"
    }
  ]
}

Proceed now without asking if this format is acceptable.
```

---

## System-Level Prompt Prefix

**Add this to ALL prompts as a prefix:**

```
=== EXECUTION MODE: AUTONOMOUS ===

Complete the entire task without stopping to ask for confirmation or approval.
Only stop if you encounter genuinely unclear requirements that prevent progress.

When in doubt:
- Choose the most reasonable approach
- Follow existing patterns in the codebase
- Use industry best practices
- Document your decisions in comments/commit messages

Now proceed with the task below:

---

[actual task prompt here]
```

---

## Implementation Checklist for Rails App

- [ ] Add autonomous execution statement to all prompt templates
- [ ] Define "complete" criteria for each job type
- [ ] Grant explicit decision-making authority
- [ ] Clarify when to ask vs when to decide
- [ ] Add system-level prefix to all prompts
- [ ] Test with real tasks to verify Claude doesn't stop unnecessarily
- [ ] Monitor for cases where Claude should have asked but didn't

---

## Examples from Your Experience

### ❌ What Caused Stopping

**Your session:**
```
[Completed 6 tasks]
"Want me to continue with task #7 (evaluating if we still need Activity Timeline)?"
```

**Why it stopped:**
- No explicit "don't ask" instruction
- Seemed like a natural checkpoint (6 done, 2 remaining)
- Documentation vs code work seemed like different scope
- Conservative default: ask before proceeding

### ✅ What Worked to Continue

**Your command:**
```
"do all"
```

**Why it worked:**
- Explicit instruction to complete everything
- Clear scope: "ALL tasks"
- No ambiguity about stopping

---

## Recommended Testing Protocol

After updating prompts:

1. **Test with simple task:**
   - "Add a hello() method to User model"
   - Should complete without asking

2. **Test with complex task:**
   - "Implement dark mode across the application"
   - Should create plan and implement without asking about approach

3. **Test with ambiguous task:**
   - "Make the app better"
   - Should ask clarifying questions (this is correct!)

4. **Test with multi-step task:**
   - "Add authentication, write tests, commit changes"
   - Should complete all steps without asking after each one

---

## Anti-Patterns to Avoid

### ❌ DON'T: Vague completion criteria
```
"Implement this feature and let me know when done."
```

### ✅ DO: Explicit completion criteria
```
"Implement this feature. You're done when tests pass and changes are committed."
```

### ❌ DON'T: Open-ended decisions
```
"Add some tests for this."
```

### ✅ DO: Clear scope
```
"Add unit tests for all public methods and integration tests for the main workflow."
```

### ❌ DON'T: Implicit authority
```
"Improve the performance."
```

### ✅ DO: Explicit authority
```
"Improve performance. You have authority to refactor code, add caching, or optimize queries as needed."
```

---

## Edge Cases to Consider

### Case 1: User wants to be asked
**Solution:** Add a flag to the job

```ruby
# Rails side
job.metadata[:require_confirmation] = true
```

```javascript
// Agent side
if (job.metadata?.require_confirmation) {
  prompt += "\n\nSTOP AND ASK: Review your plan with the user before implementing."
}
```

### Case 2: Destructive operations
**Solution:** Make explicit in prompt

```
WARNING: This may delete existing data. Proceed autonomously but document
what will be deleted in your implementation notes.
```

### Case 3: Major architectural changes
**Solution:** Define threshold in prompt

```
If your implementation requires changes to more than 5 files or affects core
architecture, document your approach first but proceed without asking for approval.
```

---

## Monitoring & Metrics

After deploying updated prompts, track:

1. **Stop rate:** % of jobs where Claude asks questions
   - Target: <10% for well-defined tasks
   - Acceptable: ~30% for ambiguous tasks

2. **Completion rate:** % of jobs completed without intervention
   - Target: >85% for standard features
   - Acceptable: >60% for complex features

3. **Quality:** % of completed jobs that work correctly first try
   - Target: >90% (same as before changes)
   - Red flag if this drops below 80%

4. **User satisfaction:** Survey whether users prefer autonomous vs ask-first
   - Expected: Most users prefer autonomous for routine tasks
   - Some users may want confirmation for risky changes

---

## Gradual Rollout Strategy

### Phase 1: Test with internal tasks (1 week)
- Update code_execution prompts only
- Monitor for issues
- Gather team feedback

### Phase 2: Expand to all job types (1 week)
- Update prd_generation and plan_generation
- Keep clarifying_questions as-is
- Monitor stop rate and quality

### Phase 3: Optimize based on data (ongoing)
- Adjust autonomy level based on metrics
- Refine completion criteria
- Add job-specific overrides as needed

---

## Summary

**Where to make changes:** Rails application prompt templates (NOT in the agent)

**What to add:**
1. "AUTONOMOUS EXECUTION MODE" statement
2. Explicit completion criteria
3. Decision-making authority grants
4. Clarification boundaries
5. System-level prefix on all prompts

**Expected result:**
- Claude completes tasks end-to-end without stopping
- Only asks when genuinely unclear (rare)
- Similar quality to current approach
- Better user experience (less waiting)

**Next steps:**
1. Locate prompt templates in Rails app
2. Update with patterns from this document
3. Test with sample tasks
4. Deploy gradually and monitor
