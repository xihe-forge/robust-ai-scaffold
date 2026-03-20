# Review Recipe: Technical & Design Document Audit

## When to Use

After creating or updating technical specifications (`docs/tech/`) or design documents (`docs/design/`).
This review is **BLOCKING** — no implementation of the designed component may begin until this passes.

## Required Tools

| Tool | Path | Purpose |
|------|------|---------|
| **impeccable** | `opensource/impeccable` | Frontend design anti-pattern detection, 17 audit commands |
| **ui-ux-pro-max-skill** | `opensource/ui-ux-pro-max-skill` | Design system validation (50+ styles, 161 palettes, 99 UX guidelines) |
| **open-lovable** | `opensource/open-lovable` | React app design reference — validates component architecture |
| **superpowers** | `opensource/superpowers` | Systematic debugging & verification methodology |

## Review Checklist

### Stage 1: Technical Spec Completeness

1. **Architecture**: Is the system architecture documented with component boundaries?
2. **Data models**: Are all entities, relationships, and schemas defined?
3. **API contracts**: Are endpoints, request/response formats, and error codes specified?
4. **Trade-offs**: Are architectural trade-offs documented with rationale (prefer ADR format)?
5. **Rollout plan**: Is there a migration/deployment strategy?
6. **PRD traceability**: Does every PRD requirement map to a tech spec section?

### Stage 2: UI/UX Design Quality (impeccable)

Run impeccable `/audit` and `/critique` commands against design specs:

1. **Typography**: Type system defined? Font pairing justified? Modular scale used?
2. **Color & Contrast**: OKLCH or proper color space? Accessibility (WCAG AA minimum)?
3. **Spatial Design**: Consistent spacing system (4px/8px grid)? Visual hierarchy clear?
4. **Motion Design**: Easing curves defined? Reduced-motion fallback specified?
5. **Interaction Design**: Form states (empty, error, success) documented? Focus states?
6. **Responsive Design**: Mobile-first? Breakpoints defined? Fluid design tokens?
7. **UX Writing**: Button labels action-oriented? Error messages helpful?

### Stage 3: Design System Validation (ui-ux-pro-max-skill)

1. **Style consistency**: Does the chosen design style (glassmorphism, minimalism, etc.) apply consistently?
2. **Color palette**: Is the palette from an established system or custom-justified?
3. **Component inventory**: Are all UI components listed with variants and states?
4. **Platform coverage**: Are target platforms (web, mobile, desktop) addressed?

### Stage 4: Anti-Pattern Detection (impeccable)

Run impeccable `/normalize` to detect:

1. **No generic AI design**: Avoid Inter font default, purple gradients, nested cards everywhere
2. **No decoration without purpose**: Every visual element serves a function
3. **No accessibility gaps**: All interactive elements keyboard-accessible
4. **No responsive breakage**: Layout works at all viewport sizes

### Stage 5: Component Architecture (open-lovable)

1. **Component decomposition**: Are components properly decomposed (atoms → molecules → organisms)?
2. **State management**: Is state ownership clear for each component?
3. **Prop interfaces**: Are component APIs (props/events) defined?

## Pass / Fail Criteria

- **PASS**: All stages satisfied, no impeccable anti-patterns detected, PRD fully traceable
- **FAIL**: Missing architecture decisions, impeccable audit findings unresolved, or PRD requirements not covered
- On FAIL: Return with specific findings. Do NOT begin implementation of affected components.

## Output

Record in `dev/review/REVIEW-TECH-DESIGN-{date}.md` with all checklist items and tool outputs.
