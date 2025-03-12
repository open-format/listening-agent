# Listening Agent

A sophisticated agent system designed to monitor, analyze, and extract valuable information from community discussions across different platforms (Discord and Telegram).

## Features

### Community Summaries
- Automatically generates summaries of community discussions
- Supports both Discord and Telegram platforms
- Processes messages within specified date ranges
- Provides structured, readable summaries of key discussions

### Task Identification
- Automatically identifies potential tasks from community discussions
- Categorizes tasks into different types:
  - Feature
  - Documentation
  - Support
  - Infrastructure
- Captures task metadata including:
  - Required skills
  - Evidence from discussions
  - Role requirements
  - Access levels
  - Experience levels required

### Community Profile Management
- Maintains comprehensive community profiles
- Stores platform-specific identifiers
- Tracks community goals
- Manages reward configurations
- Supports multiple platforms per community

## Technical Architecture

### Workflows
1. **Summary Workflow**
   - Fetches community profile
   - Retrieves messages from specified platform
   - Generates comprehensive summaries

2. **Task Workflow**
   - Identifies tasks from community discussions
   - Prevents duplicate task creation
   - Associates tasks with specific communities
   - Maintains task metadata and requirements

### Database Structure
- Uses Supabase for data storage
- Implements row-level security
- Maintains referential integrity between communities and tasks
- Stores platform-specific identifiers

### Key Components
- Platform-agnostic message fetching
- Community profile management
- Task identification and storage
- Automated summary generation

## Setup

1. Ensure you have the necessary environment variables:
   ```
   BRITTNEY_SUPABASE_URL=your_supabase_url
   BRITTNEY_SUPABASE_KEY=your_supabase_key
   ```

2. Required database tables:
   - community_profiles
   - tasks
   - messages

## Usage

The agent can be triggered with the following parameters:
```typescript
{
  startDate: Date,
  endDate: Date,
  communityId: string, // UUID
  platform: 'discord' | 'telegram'
}
```

## Security

- Row-level security enabled on all tables
- Platform-specific authentication
- Secure storage of community identifiers

## Dependencies

- TypeScript
- Zod for schema validation
- Supabase for database operations
- LangChain for AI operations
