# PULSE Troubleshooting Guide

Status: canonical


## Common Issues

### "No API key set for groq"
Your `.env` file is missing the LLM provider key. Run `npm run setup` or manually add:
```
GROQ_API_KEY=gsk_your_key_here
```
Create a key at [console.groq.com](https://console.groq.com).

### "No results found in dry-run"
- Check that you have at least 1 topic in `pulse.yaml`
- Check that `SERPER_API_KEY` is set in `.env`
- Check that at least 1 platform is enabled in `pulse.yaml`
- Run `npm run test-config` to verify all API keys

### "Rate limited" / "429 error"
- **Groq:** check your provider dashboard and reduce `aggressiveness` to `gentle`
- **Serper:** check provider usage and `data/search-quota.json` for current count
- **X/Twitter:** confirm `X_MONTHLY_POST_LIMIT` matches your approved X API tier
  and check `data/x-rate-limit.json` or hosted runtime counters for current
  writes

### "Replies sound robotic"
1. Run `npm run voice-calibrate` with 5+ sample posts
2. Set `humanBehavior.voice.casualtyLevel` higher (0.6-0.8)
3. Switch LLM provider to Anthropic (`LLM_PROVIDER=anthropic` in `.env`)
4. Check your tone setting — "technical" produces more formal output

### "Bot posted something wrong"
1. Run `npm run stop` to pause immediately
2. Delete the post manually on the platform
3. Review recent activity in the panel: `npm run panel`
4. Adjust `autopost.safety.bannedTopics` and `bannedWords`
5. Run `npm run resume` when ready

### "Panel won't start"
- Port conflict: try `npm run panel -- --port=3457`
- Check if another process is using port 3456: `lsof -i :3456`
- Check logs for errors

### "Groq is down / LLM failures"
Pulse has automatic fallback. If you have multiple API keys set:
```
GROQ_API_KEY=gsk_...
ANTHROPIC_API_KEY=sk-ant-...
```
It will try Groq first, then Anthropic automatically. Set your preferred primary in:
```
LLM_PROVIDER=groq
```

### "State corrupted / unexpected behavior"
Pulse creates `.bak` backups of state files. To restore:
```bash
cp data/outreach.json.bak data/outreach.json
cp data/opportunities.json.bak data/opportunities.json
```

### "X API auth error / 401"
- Verify all 4 X API keys are correct in `.env`
- Regenerate tokens at [developer.x.com](https://developer.x.com)
- Some X API tiers restrict replies and write volume; confirm the app has the
  approved access level for your automation plan

## Getting Help

- Check `playbooks/` for platform-specific guides
- Check `docs/how-to/customize-brand.md` for niche setup help
- File an issue on GitHub
