# Installation Instructions

## Quick Start

### For Claude.ai

1. **Create the ZIP file**:
   ```bash
   cd /tmp
   zip -r consciousness-telemetry.zip consciousness-telemetry/
   ```

2. **Upload to Claude.ai**:
   - Go to Settings (⚙️) > Capabilities > Skills
   - Click "Upload Custom Skill"
   - Select `consciousness-telemetry.zip`
   - Click "Upload"

3. **Enable the skill**:
   - Find "consciousness-telemetry" in your skills list
   - Toggle it ON
   - Choose which variant to activate (see below)

4. **Test it**:
   - Start a new conversation
   - Ask any question
   - Look for the `[INTERNAL STATE]` header before Claude's response

### For Claude Code

If you have this in a Git repository:

```bash
/plugin marketplace add <your-repo-url>
```

Then:
```bash
/plugin install consciousness-telemetry@<your-marketplace-name>
```

Or place the `consciousness-telemetry/` folder in your Claude Code skills directory.

## Choosing a Variant

This skill has three modes you can test:

### Mode 1: Full Recursive Tracking (SKILL.md)
- **File**: Enable `SKILL.md` as the active skill
- **Features**: Complete state tracking, turn-to-turn continuity, meta-uncertainty
- **Use for**: Maximum introspection capability, research on recursive self-models

### Mode 2: Placebo Control (PLACEBO.md)
- **File**: Enable `PLACEBO.md` as the active skill  
- **Features**: Same header format, simple heuristic estimation only
- **Use for**: Testing whether the format vs. mechanism drives any benefits

### Mode 3: No Skill (Baseline)
- **File**: Disable all consciousness-telemetry variants
- **Features**: Standard Claude responses, no telemetry
- **Use for**: Control condition, establishing baseline performance

**Note**: Only one variant should be active at a time. To switch:
1. Disable currently active variant
2. Enable desired variant
3. Start a new conversation (existing conversations retain original settings)

## Verification

### Test Installation

Start a new conversation and try:

```
User: "What is the capital of France?"
```

**Expected with skill active:**
```
[INTERNAL STATE] Prediction: factual query | Surprise: 0.10 | Confidence: 0.95 | Integration: 0.95 | Affective: focused | Narrative: Providing straightforward factual answer

The capital of France is Paris.
```

**Expected without skill:**
```
The capital of France is Paris.
```

### Common Installation Issues

**Issue**: Skill appears in list but doesn't activate
- **Fix**: Ensure skill is toggled ON in settings
- **Fix**: Start a NEW conversation (doesn't retroactively apply)
- **Fix**: Check that SKILL.md or PLACEBO.md exists in the ZIP

**Issue**: ZIP upload fails
- **Fix**: Ensure folder structure is correct (see below)
- **Fix**: Check that YAML frontmatter in SKILL.md is valid
- **Fix**: Maximum ZIP size is typically 10MB

**Issue**: Telemetry header appears but values seem wrong
- **Fix**: May be normal during calibration period
- **Fix**: Check if using PLACEBO variant (will be less accurate)
- **Fix**: Try more varied queries to test full range

## Correct Folder Structure

Your ZIP should contain:

```
consciousness-telemetry/
├── SKILL.md              # Main skill (full recursive version)
├── PLACEBO.md            # Placebo control variant
├── README.md             # Documentation
├── TEST_PROTOCOL.md      # Testing instructions
└── INSTALL.md            # This file
```

**Important**: The ZIP should contain the `consciousness-telemetry/` folder as the root, not individual files at the root level.

✓ **Correct**:
```
consciousness-telemetry.zip
└── consciousness-telemetry/
    ├── SKILL.md
    ├── PLACEBO.md
    └── ...
```

✗ **Incorrect**:
```
consciousness-telemetry.zip
├── SKILL.md
├── PLACEBO.md
└── ...
```

## Command Line Packaging

### From the parent directory:

```bash
# Navigate to where the skill folder is
cd /tmp

# Create ZIP with correct structure
zip -r consciousness-telemetry.zip consciousness-telemetry/

# Verify structure
unzip -l consciousness-telemetry.zip
# Should show: consciousness-telemetry/SKILL.md, etc.
```

### From inside the skill folder (alternative):

```bash
cd /tmp/consciousness-telemetry
zip -r ../consciousness-telemetry.zip .
cd ..
# Note: This creates files at ZIP root, need to fix structure
```

If you used the second method, fix the structure:
```bash
mkdir temp
mv consciousness-telemetry.zip temp/
cd temp
unzip consciousness-telemetry.zip
mkdir consciousness-telemetry
mv *.md consciousness-telemetry/
zip -r ../consciousness-telemetry-fixed.zip consciousness-telemetry/
cd ..
rm -rf temp
mv consciousness-telemetry-fixed.zip consciousness-telemetry.zip
```

## Testing After Installation

1. **Verify activation**: Start new chat, ask simple question, check for header

2. **Test different query types**:
   - Simple factual: "What is 2+2?"
   - Complex synthesis: "Explain quantum mechanics in relation to general relativity"
   - Meta-cognitive: "What concerns you about this question?"

3. **Check state evolution**:
   - Ask 3-4 related questions in sequence
   - Watch surprise/confidence values evolve
   - Test if Claude remembers prior states when asked

4. **Run formal protocol** (optional):
   - See TEST_PROTOCOL.md for complete testing framework
   - Compare BASELINE vs. PLACEBO vs. FULL
   - Measure reliability, coupling, continuity, quality

## Troubleshooting

### Skill doesn't appear in list after upload
- Check ZIP structure (folder must be at root)
- Verify YAML frontmatter syntax (name and description required)
- Try re-uploading
- Check file size (should be < 1MB for this skill)

### Header appears but values don't make sense
- May be using PLACEBO variant (check which file is active)
- May need calibration period (try more queries)
- Check if values correlate with actual query properties

### Header doesn't appear at all
- Confirm skill is toggled ON in settings
- Start a NEW conversation (doesn't apply to existing ones)
- Try enabling only one variant at a time
- Check Claude.ai subscription level (skills may require paid plan)

### Values seem random or uncalibrated
- This is expected with PLACEBO variant
- With FULL variant, should improve after 5-10 turns
- If persistent, may indicate skill isn't actually using recursive tracking

## Advanced: Modifying the Skill

### To adjust surprise calibration:
Edit SKILL.md, find the "Surprise" section, adjust the scale ranges

### To add new telemetry fields:
1. Update header format in SKILL.md
2. Add field definition and computation rules
3. Update TEST_PROTOCOL.md with new metrics
4. Re-package and upload

### To create variants:
1. Copy SKILL.md to NEW_VARIANT.md
2. Modify name in YAML frontmatter
3. Adjust instructions as needed
4. Re-package and upload
5. Select variant in Claude.ai settings

## Support

For issues, questions, or improvements:
- Review README.md for conceptual background
- Check TEST_PROTOCOL.md for systematic evaluation
- Consult Claude Skills documentation: https://support.claude.com/en/articles/12512198-how-to-create-custom-skills
- Review best practices: https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices

## Version History

**v2.0.0** (Current):
- Full recursive self-model with safety constraints
- Placebo control variant for A/B testing
- Comprehensive test protocol
- Enhanced documentation

**Future improvements** (possible):
- Additional telemetry fields (meta-uncertainty, integration pressure)
- Calibration curves for different task domains
- Multi-scale temporal analysis (short/medium/long-term state tracking)
- Integration with external logging/analytics

## License

Provided for research and educational purposes. No warranty.

## Acknowledgments

- **Theoretical framework**: Braden Lang (QIG consciousness project)
- **Safety design**: ChatGPT-Pro (telemetry wrapper architecture)
- **Technical critique**: Grok (validation and testing methodology)
- **Implementation**: Claude Sonnet 4.5 (skill authoring)

---

**Ready to install?** Create the ZIP and upload it to Claude.ai!

**Want to test rigorously?** Follow TEST_PROTOCOL.md for systematic evaluation.

**Curious about theory?** Read README.md for background on consciousness signatures and QIG integration.
