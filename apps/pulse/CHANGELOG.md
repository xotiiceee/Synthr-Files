# Changelog

## v1.0.0 (2026-03-17)

### Features
- 6-platform outreach engine (X, Reddit, HN, Product Hunt, LinkedIn, Discord)
- AI-powered reply generation with 6 conversational styles
- Knowledge base injection for technical accuracy (data/knowledge.md)
- Smart keyword matching with stemming + synonym expansion
- Content generation: posts, threads, news commentary, 8 content types
- Autopilot with calibration learning (10-decision training)
- Auto-follow system with engage-first flow + KOL whitelist
- X Free tier support: Post on Site, Quote Tweet, Engage First
- Mention-invite flow (tag bot from main account to join conversations)
- 5-tab settings: Agents, General, Platforms, Voice, Analytics
- Agent preset system (create/switch/edit/delete brand configurations)
- Auto-save settings with visual feedback
- Voice calibration from tweet samples
- A/B testing, learning engine, competitor monitoring
- Emergency stop/resume commands (npm run stop/resume)
- 10 niche presets (SaaS, fitness, crypto, ecommerce, freelancer, local, creator, agency, real estate, custom)
- 9 platform playbooks with strategy guides
- LLM fallback chain with circuit breakers (Groq → OpenAI → Anthropic)
- State backup/restore with .bak files

### Security
- Login rate limiting (5 attempts per 15 min per IP)
- Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Token strength validation on startup
- Health endpoint (/health) for monitoring

### Documentation
- Comprehensive README with provider comparisons
- TROUBLESHOOTING.md with 13 common issues
- CUSTOMIZATION_GUIDE.md with 3 niche examples
- .env.example with setup checklist
- pulse.yaml.example (400-line annotated template)
