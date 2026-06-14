# Prompt Customization Guide

PULSE's output quality comes from its prompts. This playbook explains how to customize them for your specific niche, tone, and goals.

## Where Prompts Live

All prompts are in the `src/prompts/` directory:

```
src/prompts/
  reply-x.txt          # X/Twitter reply generation
  reply-reddit.txt     # Reddit comment generation
  reply-discord.txt    # Discord message generation
  search-queries.txt   # Topic → search query expansion
  content-post.txt     # Original post generation
  content-thread.txt   # Thread/long-form generation
  relevance-filter.txt # Scores conversation relevance (0-100)
  tone-adapter.txt     # Adjusts tone per platform
  summary.txt          # Report and analytics summaries
```

Each prompt file contains the system instruction sent to the LLM. They use template variables (wrapped in `{{double braces}}`) that PULSE fills in at runtime.

## How to Customize Reply Style

Open any reply prompt (e.g., `src/prompts/reply-x.txt`) and look for the style section. The default looks something like:

```
Reply style:
- Conversational and direct
- No marketing language
- Match the energy of the original post
- Maximum {{maxLength}} characters
```

You can modify these instructions to match your brand:

**For a technical audience:**
```
Reply style:
- Technical and precise — use correct terminology
- Include code snippets or CLI examples when relevant
- Skip pleasantries, get to the point
- Assume the reader is an experienced developer
```

**For a casual/friendly brand:**
```
Reply style:
- Warm and approachable
- Use analogies to explain complex ideas
- Light humor is fine, sarcasm is not
- Write like you're talking to a friend who asked for advice
```

**For B2B/enterprise:**
```
Reply style:
- Professional but not stiff
- Reference business outcomes (cost savings, time saved, risk reduced)
- Use specific numbers when available
- No slang, no emojis
```

## Adding New Reply Styles

You can create additional prompt variants for different contexts:

1. Copy an existing prompt file (e.g., `cp reply-x.txt reply-x-technical.txt`)
2. Modify the style, tone, and constraints
3. Reference it in your config:

```yaml
platforms:
  x:
    promptVariants:
      default: "reply-x.txt"
      technical: "reply-x-technical.txt"
    variantRules:
      - match: "subreddit:programming"
        use: "technical"
```

PULSE selects the variant based on context (subreddit, channel, topic keywords). You can define as many variants as needed.

## Adjusting the Relevance Filter

The relevance filter (`src/prompts/relevance-filter.txt`) scores every conversation from 0-100. Only conversations above your `relevanceThreshold` (default: 60) get a reply.

**If you're getting too many irrelevant matches** (replying to off-topic conversations):

- Raise `relevanceThreshold` to 70 or 75 in `pulse.yaml`
- Add negative keywords to the prompt: "Score 0 if the conversation is about [irrelevant topic]"
- Be more specific in your topic definitions

**If you're getting too few matches** (PULSE isn't finding enough conversations):

- Lower `relevanceThreshold` to 50
- Broaden your topic keywords
- Add adjacent topics (e.g., if you sell a deployment tool, add "CI/CD", "DevOps", "infrastructure" as topics)

**Fine-tuning relevance scoring:**

Add weighting instructions to the prompt:
```
Scoring guidelines:
- Direct question about our problem space: 80-100
- Discussion mentioning our category: 60-80
- Tangentially related conversation: 40-60
- Unrelated but in our industry: 20-40
- Completely unrelated: 0-20
```

## Temperature Settings

Temperature controls how creative vs. consistent the LLM output is. Configure in `pulse.yaml`:

```yaml
llm:
  temperature: 0.7        # Global default
  temperatureByTask:
    reply: 0.7             # Moderate creativity for replies
    content: 0.8           # More creative for original content
    relevanceFilter: 0.2   # Very consistent for scoring
    searchQueries: 0.3     # Low creativity for search accuracy
```

**Guidelines:**

- **0.1-0.3:** Very consistent output. Good for scoring, classification, and search queries where you want predictable results.
- **0.4-0.6:** Balanced. Good for replies where you want variety but not wildness.
- **0.7-0.8:** Creative. Good for original content, threads, and posts where freshness matters.
- **0.9-1.0:** Maximum variety. Can produce unexpected and sometimes off-brand results. Use sparingly.

If your replies start sounding repetitive, nudge the reply temperature up by 0.1. If they sound erratic, nudge it down.

## Testing Prompt Changes

Always test before deploying prompt changes to live platforms:

```bash
# Test a specific prompt with sample input
npm run test-prompt -- --prompt reply-x.txt --input "sample tweet text"

# Full dry run with your modified prompts
npm run dry-run

# Dry run for a specific platform
npm run dry-run -- --platform reddit

# Compare old vs new prompt output side by side
npm run test-prompt -- --prompt reply-x.txt --compare reply-x-backup.txt --input "sample tweet"
```

**Workflow for prompt iteration:**

1. Back up the current prompt: `cp src/prompts/reply-x.txt src/prompts/reply-x.backup.txt`
2. Make your changes
3. Run `npm run dry-run` and review 10-20 generated replies
4. If the quality improved, keep the changes. If not, restore from backup.
5. After deploying, check `npm run report` after 48 hours to compare engagement metrics with the previous period

Small, incremental changes work better than major rewrites. Change one thing at a time so you can attribute improvements accurately.
