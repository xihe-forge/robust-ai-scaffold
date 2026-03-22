# Review Recipe: MRD & PRD Audit

## When to Use

After creating or updating Market Research Documents (MRD) or Product Requirements Documents (PRD).
This review is **BLOCKING** — no implementation tasks may begin until MRD/PRD passes review.

## Required Tools

This review uses the scaffold's built-in review methodology. No external skill modules required.

## Review Checklist

### Stage 1: MRD Completeness

Verify market research coverage:

1. **Persona validation**: Are user personas defined with goals, frustrations, and behaviors?
2. **Market sizing**: Is TAM/SAM/SOM estimated with methodology documented?
3. **Competitive landscape**: Are direct/indirect competitors mapped with differentiation?
4. **User journey**: Are key user flows mapped with pain points identified?
5. **Segmentation**: Are target segments clearly defined and prioritized?

### Stage 2: PRD Quality

Verify PRD completeness and rigor:

1. **Problem statement**: Is the problem clearly stated from the user's perspective?
2. **User stories/flows**: Are all user-facing behaviors described as testable stories?
3. **Acceptance criteria**: Does EVERY requirement have explicit, measurable acceptance criteria?
4. **Scope boundaries**: Are out-of-scope items explicitly listed?
5. **Dependencies**: Are external dependencies and assumptions documented?
6. **Success metrics**: Are measurable success criteria defined?

### Stage 3: Strategic Alignment

1. **Vision fit**: Does the PRD align with the project vision in PROJECT.md?
2. **Business model**: Is the value proposition clear?
3. **Pricing consideration**: If applicable, is pricing/packaging addressed?

### Stage 4: Plan Structure

Verify plan decomposability:

1. **Decomposable**: Can the PRD be broken into independent, parallelizable tasks?
2. **Testable**: Can each requirement be verified with automated tests?
3. **Sized correctly**: Are requirements small enough for a single agent round?

## Pass / Fail Criteria

- **PASS**: All Stage 1-4 checks satisfied, every requirement has acceptance criteria
- **FAIL**: Any missing persona, no market sizing, requirements without acceptance criteria, or untestable requirements
- On FAIL: Return to author with specific gaps listed. Do NOT proceed to implementation.

## Output

Record in `dev/review/REVIEW-MRD-PRD-{date}.md`:

```markdown
# MRD/PRD Review: {date}

## Tools Used
- Scaffold built-in review methodology

## Stage 1: MRD Completeness
- [ ] Personas defined
- [ ] Market sizing complete
- [ ] Competitive analysis done
- [ ] User journeys mapped
- [ ] Segments identified

## Stage 2: PRD Quality
- [ ] Problem statement clear
- [ ] All user stories testable
- [ ] Acceptance criteria on every requirement
- [ ] Scope boundaries defined
- [ ] Dependencies documented
- [ ] Success metrics measurable

## Stage 3: Strategic Alignment
- [ ] Vision alignment verified
- [ ] Value proposition clear

## Stage 4: Plan Structure
- [ ] Decomposable into tasks
- [ ] All requirements testable
- [ ] Properly sized

## Verdict: PASS / FAIL
## Gaps Found: (list)
## Action Items: (list)
```
