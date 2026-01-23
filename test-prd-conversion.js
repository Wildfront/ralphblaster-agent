#!/usr/bin/env node

/**
 * Integration test for PRD conversion
 * Tests the full conversion flow from markdown PRD to prd.json
 */

const fs = require('fs').promises;
const path = require('path');
const RalphInstanceManager = require('./src/ralph-instance-manager');

// Sample PRD for testing
const samplePRD = `# Add User Profile Feature

Add ability for users to view and edit their profile information.

## Requirements

### Profile Display
- Display user name, email, and avatar
- Show account creation date
- Display user role/permissions

### Profile Editing
- Allow editing of name and email
- Allow avatar upload
- Validate email format before saving

### Backend
- Add profile endpoint to API
- Store changes in database
- Send confirmation email on profile update

## Technical Notes
- Use existing authentication system
- Follow REST API conventions
- Add proper input validation
`;

async function runTest() {
  console.log('🧪 Running PRD conversion integration test...\n');

  const testDir = path.join(__dirname, 'test-output');
  const instancePath = path.join(testDir, 'ralph-instance');

  try {
    // Clean up any previous test artifacts
    console.log('1️⃣  Setting up test environment...');
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(instancePath, { recursive: true });
    console.log('   ✓ Test directory created\n');

    // Create instance manager
    console.log('2️⃣  Creating Ralph instance manager...');
    const manager = new RalphInstanceManager();
    console.log('   ✓ Manager created\n');

    // Convert PRD
    console.log('3️⃣  Converting PRD to JSON...');
    console.log('   PRD length:', samplePRD.length, 'bytes');
    console.log('   Instance path:', instancePath);

    await manager.convertPrdToJson(instancePath, samplePRD);
    console.log('   ✓ Conversion completed\n');

    // Read and validate the generated prd.json
    console.log('4️⃣  Validating generated prd.json...');
    const prdJsonPath = path.join(instancePath, 'prd.json');
    const prdContent = await fs.readFile(prdJsonPath, 'utf8');
    const prd = JSON.parse(prdContent);

    console.log('\n📄 Generated PRD Structure:');
    console.log('   Project:', prd.project || '(not set)');
    console.log('   Branch:', prd.branchName);
    console.log('   Description:', prd.description?.substring(0, 50) + '...');
    console.log('   User Stories:', prd.userStories?.length || 0);

    if (prd.userStories && prd.userStories.length > 0) {
      console.log('\n📋 User Stories:');
      prd.userStories.forEach((story, idx) => {
        console.log(`   ${idx + 1}. [${story.id}] ${story.title}`);
        console.log(`      Priority: ${story.priority}, Status: ${story.passes ? '✓ Pass' : '○ Pending'}`);
        console.log(`      Acceptance Criteria: ${story.acceptanceCriteria?.length || 0} items`);
      });
    }

    // Validation checks
    console.log('\n5️⃣  Running validation checks...');
    const errors = [];

    if (!prd.branchName) {
      errors.push('Missing branchName');
    } else if (!prd.branchName.startsWith('ralph/')) {
      errors.push('branchName does not start with "ralph/"');
    }

    if (!prd.userStories || !Array.isArray(prd.userStories)) {
      errors.push('Missing or invalid userStories array');
    } else if (prd.userStories.length === 0) {
      errors.push('userStories array is empty');
    } else {
      // Check each story
      prd.userStories.forEach((story, idx) => {
        if (!story.id) errors.push(`Story ${idx + 1} missing id`);
        if (!story.title) errors.push(`Story ${idx + 1} missing title`);
        if (!story.description) errors.push(`Story ${idx + 1} missing description`);
        if (!story.acceptanceCriteria || !Array.isArray(story.acceptanceCriteria)) {
          errors.push(`Story ${idx + 1} missing acceptanceCriteria`);
        } else {
          // Check for "Typecheck passes" criterion
          const hasTypecheck = story.acceptanceCriteria.some(c =>
            c.toLowerCase().includes('typecheck')
          );
          if (!hasTypecheck) {
            errors.push(`Story ${idx + 1} missing "Typecheck passes" criterion`);
          }
        }
        if (story.priority === undefined || story.priority === null) {
          errors.push(`Story ${idx + 1} missing priority`);
        }
        if (story.passes !== false) {
          errors.push(`Story ${idx + 1} should have passes=false initially`);
        }
      });
    }

    if (errors.length > 0) {
      console.log('\n❌ Validation errors found:');
      errors.forEach(err => console.log('   •', err));
      process.exit(1);
    } else {
      console.log('   ✓ All validation checks passed\n');
    }

    // Show full JSON
    console.log('\n📝 Full prd.json content:');
    console.log('─'.repeat(60));
    console.log(JSON.stringify(prd, null, 2));
    console.log('─'.repeat(60));

    console.log('\n✅ Integration test PASSED!\n');
    console.log('Test artifacts saved to:', testDir);

  } catch (error) {
    console.error('\n❌ Integration test FAILED!\n');
    console.error('Error:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
runTest();
